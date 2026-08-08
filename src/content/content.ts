import { Message } from '@/shared/types';

declare global {
  interface Window {
    __nitpickInjected?: boolean;
  }
}

if (!window.__nitpickInjected) {
  window.__nitpickInjected = true;
  init();
}

function init(): void {
  let pinElement: HTMLElement | null = null;
  let captureOverlay: HTMLElement | null = null;

  chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message.type === 'injectOverlay') {
      injectCaptureOverlay();
      sendResponse({ success: true });
    } else if (message.type === 'removePin') {
      removePin();
      sendResponse({ success: true });
    }
    return false;
  });

  function injectCaptureOverlay(): void {
    if (captureOverlay) return;
    removePin();

    captureOverlay = document.createElement('div');
    captureOverlay.id = '__nitpick-capture-overlay';
    captureOverlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: transparent;
      cursor: crosshair;
      z-index: 2147483647;
    `;

    captureOverlay.addEventListener('click', handlePinClick);
    document.addEventListener('keydown', handleEscape, true);
    document.documentElement.appendChild(captureOverlay);
  }

  function handleEscape(e: KeyboardEvent): void {
    if (e.key === 'Escape' && captureOverlay) {
      e.stopPropagation();
      removeOverlay();
      chrome.runtime.sendMessage({ type: 'cancelPin' });
    }
  }

  function removeOverlay(): void {
    if (captureOverlay) {
      captureOverlay.remove();
      captureOverlay = null;
    }
    document.removeEventListener('keydown', handleEscape, true);
  }

  function handlePinClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const { clientX, clientY } = event;
    const dpr = window.devicePixelRatio;

    pinElement = document.createElement('div');
    pinElement.id = '__nitpick-pin-marker';
    pinElement.innerHTML = getPinSVG();
    pinElement.style.cssText = `
      position: fixed;
      left: ${clientX - 12}px;
      top: ${clientY - 24}px;
      z-index: 2147483646;
      width: 24px;
      height: 24px;
      pointer-events: none;
    `;

    document.documentElement.appendChild(pinElement);
    removeOverlay();

    chrome.runtime.sendMessage({
      type: 'pinPlaced',
      x: clientX,
      y: clientY,
      dpr,
      pageUrl: window.location.href,
    });
  }

  function removePin(): void {
    if (pinElement) {
      pinElement.remove();
      pinElement = null;
    }
    removeOverlay();
    const stale = document.getElementById('__nitpick-pin-marker');
    if (stale) stale.remove();
  }

  function getPinSVG(): string {
    return `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#E5484D" stroke="#FFFFFF" stroke-width="1.5"/>
        <circle cx="12" cy="9" r="2.5" fill="#FFFFFF"/>
      </svg>
    `;
  }
}
