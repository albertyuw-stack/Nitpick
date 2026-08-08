import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Message, PinCoordinates, TicketInfo, TICKET_ID_REGEX } from '@/shared/types';

type Screen = 'connect' | 'main';
type SubmitStage = 'idle' | 'submitting' | 'retry-comment';

interface ScreenshotState {
  dataUrl: string;
  pin: PinCoordinates;
}

const PinLogo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"
      fill="var(--color-primary)"
    />
    <circle cx="12" cy="9" r="2.5" fill="#fff" />
  </svg>
);

export function App() {
  const [screen, setScreen] = useState<Screen>('connect');
  const [checkingStored, setCheckingStored] = useState(true);

  // Connection state
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [useCloudAuth, setUseCloudAuth] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  // Ticket state
  const [ticketKey, setTicketKey] = useState('');
  const [detectedKey, setDetectedKey] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);

  // Pin/screenshot state
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotState | null>(null);

  // Compose state
  const [comment, setComment] = useState('');
  const [submitStage, setSubmitStage] = useState<SubmitStage>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const validateTimer = useRef<ReturnType<typeof setTimeout>>();

  // On mount: check stored connection
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'testConnection' }).then(result => {
      if (result?.success) {
        setDisplayName(result.displayName ?? null);
        setScreen('main');
      }
      setCheckingStored(false);
    }).catch(() => setCheckingStored(false));
  }, []);

  // Listen for worker broadcasts
  useEffect(() => {
    const listener = (message: Message) => {
      if (message.type === 'urlTicketDetected') {
        setDetectedKey(message.key);
      } else if (message.type === 'screenshotReady') {
        setScreenshot({ dataUrl: message.dataUrl, pin: message.pin });
        setPinning(false);
        setPinError(null);
      } else if (message.type === 'pinError') {
        setPinError(message.message);
        setPinning(false);
      } else if (message.type === 'cancelPin') {
        setPinning(false);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // Check current tab for a ticket ID when panel opens
  useEffect(() => {
    if (screen !== 'main') return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      const match = tab?.url?.match(TICKET_ID_REGEX);
      if (match) setDetectedKey(match[0]);
    });
  }, [screen]);

  const validateTicket = useCallback((key: string) => {
    setTicket(null);
    setTicketError(null);
    if (!key || !TICKET_ID_REGEX.test(key)) return;
    setValidating(true);
    chrome.runtime.sendMessage({ type: 'validateTicket', key }).then(result => {
      setValidating(false);
      if (result?.success && result.ticket) {
        setTicket(result.ticket);
      } else {
        setTicketError(result?.error ?? 'Ticket not found');
      }
    }).catch(() => {
      setValidating(false);
      setTicketError('Could not reach Jira');
    });
  }, []);

  // Debounced validation on manual entry
  useEffect(() => {
    clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(() => validateTicket(ticketKey.trim().toUpperCase()), 400);
    return () => clearTimeout(validateTimer.current);
  }, [ticketKey, validateTicket]);

  const applyDetectedKey = () => {
    if (detectedKey) {
      setTicketKey(detectedKey);
      setDetectedKey(null);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectError(null);
    setConnecting(true);

    let origin: string;
    try {
      origin = new URL(baseUrl.trim()).origin;
    } catch {
      setConnectError('Enter a valid URL, e.g. https://jira.mycompany.com');
      setConnecting(false);
      return;
    }

    // Host permission must be requested here (user gesture context)
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) {
      setConnectError('Permission to access the Jira domain is required');
      setConnecting(false);
      return;
    }

    const result = await chrome.runtime.sendMessage({
      type: 'connect',
      baseUrl: baseUrl.trim(),
      token: token.trim(),
      email: useCloudAuth ? email.trim() : undefined,
    }).catch(err => ({ success: false, error: String(err) }));

    setConnecting(false);
    if (result?.success) {
      setDisplayName(result.displayName ?? null);
      setScreen('main');
    } else {
      setConnectError(result?.error ?? 'Connection failed');
    }
  };

  const handleDropPin = async () => {
    setPinError(null);
    setPinning(true);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setPinError('No active tab found');
      setPinning(false);
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: 'startPinMode', tabId: tab.id })
      .catch(err => ({ success: false, error: String(err) }));
    if (!result?.success) {
      setPinError(result?.error ?? "Pins can't be placed on this page");
      setPinning(false);
    }
    // On success, we wait for the screenshotReady broadcast
  };

  const handleCancelPin = () => {
    chrome.runtime.sendMessage({ type: 'cancelPin' }).catch(() => {});
    setScreenshot(null);
    setPinning(false);
    setPinError(null);
  };

  const handleSubmit = async () => {
    if (!ticket || !screenshot) return;
    setSubmitError(null);
    setSubmitStage('submitting');

    const result = await chrome.runtime.sendMessage({
      type: 'submit',
      key: ticket.key,
      comment: comment.trim() || 'Screenshot pin',
      imageDataUrl: screenshot.dataUrl,
      pin: screenshot.pin,
    }).catch(err => ({ success: false, error: String(err) }));

    if (result?.success) {
      setSubmitStage('idle');
      setSubmitSuccess(true);
      setScreenshot(null);
      setComment('');
      setTimeout(() => setSubmitSuccess(false), 4000);
    } else {
      setSubmitStage(result?.stage === 'comment' ? 'retry-comment' : 'idle');
      setSubmitError(result?.error ?? 'Submission failed');
    }
  };

  const handleDisconnect = () => {
    chrome.storage.local.remove('jiraConfig');
    setScreen('connect');
    setDisplayName(null);
    setTicket(null);
    setScreenshot(null);
  };

  if (checkingStored) {
    return (
      <div className="panel">
        <div className="empty-state" style={{ marginTop: 80 }}>
          <div className="spinner spinner-dark" />
          <span>Loading…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <div className="brand">
          <PinLogo />
          Nitpick
        </div>
        {screen === 'main' && displayName && (
          <div className="header-user">
            <span className="dot" />
            {displayName}
          </div>
        )}
      </header>

      <div className="panel-body">
        {screen === 'connect' ? (
          <form className="card" onSubmit={handleConnect}>
            <div className="card-title">Connect to Jira</div>

            <div className="field">
              <label htmlFor="baseUrl">Jira base URL</label>
              <input
                id="baseUrl"
                type="url"
                placeholder="https://jira.mycompany.com"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="token">{useCloudAuth ? 'API token' : 'Personal Access Token'}</label>
              <input
                id="token"
                type="password"
                placeholder={useCloudAuth ? 'Jira Cloud API token' : 'PAT from your Jira profile'}
                value={token}
                onChange={e => setToken(e.target.value)}
                required
              />
              <span className="hint">
                {useCloudAuth
                  ? 'Cloud instances use email + API token'
                  : 'Data Center 8.14+: create one under Profile → Personal Access Tokens'}
              </span>
            </div>

            {useCloudAuth && (
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
              </div>
            )}

            {connectError && <div className="banner banner-error" style={{ marginBottom: 12 }}>{connectError}</div>}

            <button className="btn btn-primary" type="submit" disabled={connecting}>
              {connecting ? <><span className="spinner" /> Connecting…</> : 'Connect'}
            </button>

            <div style={{ marginTop: 10, textAlign: 'center' }}>
              <button
                type="button"
                className="settings-link"
                onClick={() => setUseCloudAuth(v => !v)}
              >
                {useCloudAuth ? 'Using a Data Center instance? Switch to PAT' : 'Using Jira Cloud? Switch to email + API token'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Ticket section */}
            <div className="card">
              <div className="card-title">Ticket</div>

              {detectedKey && detectedKey !== ticketKey && (
                <div style={{ marginBottom: 10 }}>
                  <button type="button" className="chip" onClick={applyDetectedKey} style={{ border: 'none', cursor: 'pointer' }}>
                    Detected on this page: {detectedKey} — use it
                  </button>
                </div>
              )}

              <div className="field">
                <label htmlFor="ticketKey">Ticket ID</label>
                <input
                  id="ticketKey"
                  type="text"
                  placeholder="MIST-12345"
                  value={ticketKey}
                  onChange={e => setTicketKey(e.target.value.toUpperCase())}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {validating && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                  <span className="spinner spinner-dark" /> Looking up ticket…
                </div>
              )}

              {ticketError && <div className="banner banner-error">{ticketError}</div>}

              {ticket && (
                <div className="ticket-card">
                  <span className="ticket-key">{ticket.key}</span>
                  <span className="ticket-summary">{ticket.summary}</span>
                  <div className="ticket-meta">
                    <span className="ticket-status">{ticket.status}</span>
                    {ticket.assignee && <span>Assignee: {ticket.assignee}</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Pin & screenshot section */}
            <div className="card">
              <div className="card-title">Pin &amp; Screenshot</div>

              {pinError && <div className="banner banner-error" style={{ marginBottom: 10 }}>{pinError}</div>}

              {!screenshot ? (
                <>
                  {pinning ? (
                    <div className="empty-state">
                      <div className="spinner spinner-dark" />
                      <span>Click anywhere on the page to drop a pin.<br />Press Esc to cancel.</span>
                      <button className="btn btn-ghost" type="button" onClick={handleCancelPin}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn btn-primary" type="button" onClick={handleDropPin}>
                      <PinLogo /> Drop a pin
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="screenshot-preview" style={{ marginBottom: 12 }}>
                    <img src={screenshot.dataUrl} alt="Screenshot with pin" />
                    <span className="pin-coords">
                      ({Math.round(screenshot.pin.x)}, {Math.round(screenshot.pin.y)})
                    </span>
                  </div>

                  <div className="field">
                    <label htmlFor="comment">Comment</label>
                    <textarea
                      id="comment"
                      placeholder="Describe the issue at this pin…"
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                    />
                  </div>

                  {submitError && (
                    <div className="banner banner-warning" style={{ marginBottom: 10 }}>
                      {submitError}
                      {submitStage === 'retry-comment' && ' — the screenshot is already attached; retrying will only re-post the comment.'}
                    </div>
                  )}

                  <div className="btn-row">
                    <button className="btn btn-secondary" type="button" onClick={handleCancelPin} disabled={submitStage === 'submitting'}>
                      Discard
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleSubmit}
                      disabled={!ticket || submitStage === 'submitting'}
                    >
                      {submitStage === 'submitting'
                        ? <><span className="spinner" /> Sending…</>
                        : submitStage === 'retry-comment' ? 'Retry comment' : 'Send to Jira'}
                    </button>
                  </div>
                  {!ticket && (
                    <div className="hint" style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      Select a valid ticket above to enable sending.
                    </div>
                  )}
                </>
              )}
            </div>

            {submitSuccess && (
              <div className="banner banner-success">
                Pin sent to {ticket?.key ?? 'Jira'} — screenshot attached and comment posted.
              </div>
            )}

            <div style={{ textAlign: 'center', marginTop: 'auto', paddingTop: 8 }}>
              <button type="button" className="settings-link" onClick={handleDisconnect}>
                Disconnect from Jira
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
