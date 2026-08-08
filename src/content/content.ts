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

    pinElement = buildPinMarker(clientX, clientY);
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

  // Numbered teardrop marker from the Mist design spec ("Placed" state):
  // red-500 body, white 2px ring, soft red halo — legible on light and
  // dark pages. The tip of the teardrop lands on the click point.
  function buildPinMarker(x: number, y: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.id = '__nitpick-pin-marker';
    wrapper.style.cssText = `
      position: fixed;
      left: ${x - 18}px;
      top: ${y - 38}px;
      width: 36px;
      height: 36px;
      z-index: 2147483646;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const halo = document.createElement('span');
    halo.style.cssText = `
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: rgba(229,62,62,.18);
    `;

    const pin = document.createElement('div');
    pin.style.cssText = `
      width: 28px;
      height: 28px;
      background: rgb(229,62,62);
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,.35);
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const badge = document.createElement('span');
    badge.textContent = '1';
    badge.style.cssText = `
      transform: rotate(45deg);
      color: #fff;
      font: 700 12px Inter, sans-serif;
    `;

    pin.appendChild(badge);
    wrapper.appendChild(halo);
    wrapper.appendChild(pin);
    return wrapper;
  }
}
