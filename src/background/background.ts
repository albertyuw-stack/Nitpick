import { JiraClient } from './jira-client';
import { Message, TICKET_ID_REGEX } from '@/shared/types';

const jiraClient = new JiraClient();
let activePinTabId: number | null = null;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  handleMessage(message, sender.tab?.id)
    .then(sendResponse)
    .catch(error => sendResponse({ success: false, error: String(error) }));
  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    detectTicketFromUrl(tab.url);
  } catch {
    // Tab may have closed
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    detectTicketFromUrl(tab.url);
  }
});

function detectTicketFromUrl(url?: string): void {
  if (!url) return;
  const match = url.match(TICKET_ID_REGEX);
  if (match) {
    broadcastToPanel({ type: 'urlTicketDetected', key: match[0] });
  }
}

async function handleMessage(message: Message, senderTabId?: number): Promise<any> {
  switch (message.type) {
    case 'connect':
      return jiraClient.connect(message.baseUrl, message.token, message.email);

    case 'testConnection':
      return jiraClient.testConnection();

    case 'validateTicket': {
      const ticket = await jiraClient.getTicket(message.key);
      return ticket
        ? { success: true, ticket }
        : { success: false, error: 'Ticket not found' };
    }

    case 'startPinMode': {
      activePinTabId = message.tabId;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          files: ['content.js'],
        });
      } catch (error) {
        return { success: false, error: "Pins can't be placed on this page" };
      }
      await chrome.tabs.sendMessage(message.tabId, { type: 'injectOverlay' });
      return { success: true };
    }

    case 'pinPlaced': {
      const tabId = senderTabId ?? activePinTabId;
      if (tabId === null) {
        return { success: false, error: 'No active pin tab' };
      }
      // Let the pin marker paint before capturing
      await new Promise(resolve => setTimeout(resolve, 60));
      try {
        const tab = await chrome.tabs.get(tabId);
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        broadcastToPanel({
          type: 'screenshotReady',
          dataUrl,
          pin: { x: message.x, y: message.y, dpr: message.dpr, pageUrl: message.pageUrl },
        });
        return { success: true };
      } catch (error) {
        broadcastToPanel({ type: 'pinError', message: 'Failed to capture screenshot' });
        return { success: false, error: String(error) };
      }
    }

    case 'submit': {
      const blob = await dataUrlToBlob(message.imageDataUrl);
      const filename = buildFilename(message.key);

      const attachResult = await jiraClient.attachScreenshot(message.key, blob, filename);
      if (!attachResult.success) {
        return { success: false, error: `Attachment failed: ${attachResult.error}`, stage: 'attachment' };
      }

      const pinLocation = `(${Math.round(message.pin.x)}, ${Math.round(message.pin.y)}) at ${message.pin.pageUrl}`;
      const commentResult = await jiraClient.postComment(message.key, message.comment, filename, pinLocation);

      if (!commentResult.success) {
        return {
          success: false,
          error: `Screenshot attached, but comment failed: ${commentResult.error}`,
          stage: 'comment',
          filename,
        };
      }

      cleanupPin();
      return { success: true };
    }

    case 'cancelPin': {
      cleanupPin();
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

function cleanupPin(): void {
  if (activePinTabId !== null) {
    chrome.tabs.sendMessage(activePinTabId, { type: 'removePin' }).catch(() => {});
    activePinTabId = null;
  }
}

function buildFilename(key: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `pin-${key}-${stamp}.png`;
}

function broadcastToPanel(message: Message): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Panel not open
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
