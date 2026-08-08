import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Message, PinCoordinates, TicketInfo, TICKET_ID_REGEX } from '@/shared/types';
import { buildProjectRegex, loadTicketRegex } from '@/shared/ticket-pattern';
import { Alert, Avatar, Button, Icon, IconButton, Input, PinMarker, Spinner, StatusTag, Textarea } from './mist';

type Screen = 'loading' | 'setup' | 'connected-splash' | 'main' | 'compose' | 'success';

const label: React.CSSProperties = {
  font: "600 12px Inter,sans-serif",
  color: 'var(--color-gray-700)',
};

const PAT_DOCS_URL = 'https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html';

function statusTagVariant(status: string): string {
  const s = status.toLowerCase();
  if (/(done|closed|resolved)/.test(s)) return 'success';
  if (/(blocked|reopen)/.test(s)) return 'critical';
  return 'info';
}

function domainOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function App() {
  const [screen, setScreen] = useState<Screen>('loading');

  // Connection
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [email, setEmail] = useState('');
  const [useCloudAuth, setUseCloudAuth] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [instanceDomain, setInstanceDomain] = useState('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // Settings — optional Jira space key used for ticket-ID scanning
  const [pattern, setPattern] = useState('');
  const [patternError, setPatternError] = useState<string | null>(null);

  // Ticket
  const [ticketKey, setTicketKey] = useState('');
  const [detectedChip, setDetectedChip] = useState(false);
  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);

  // Pin & compose
  const [pinning, setPinning] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [screenshot, setScreenshot] = useState<{ dataUrl: string; pin: PinCoordinates } | null>(null);
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postErrorStage, setPostErrorStage] = useState<'attachment' | 'comment' | null>(null);

  const validateTimer = useRef<ReturnType<typeof setTimeout>>();
  const ticketRef = useRef<TicketInfo | null>(null);
  ticketRef.current = ticket;

  /* ── boot: restore stored connection + settings ── */
  useEffect(() => {
    Promise.all([
      chrome.storage.local.get(['jiraConfig', 'ticketProject']),
      chrome.runtime.sendMessage({ type: 'testConnection' }).catch(() => null),
    ]).then(([stored, result]) => {
      const cfg = stored.jiraConfig;
      if (stored.ticketProject) setPattern(stored.ticketProject);
      if (cfg?.baseUrl) {
        setBaseUrl(cfg.baseUrl);
        setInstanceDomain(domainOf(cfg.baseUrl));
      }
      if (result?.success) {
        setIsConnected(true);
        setScreen('main');
      } else if (cfg?.baseUrl) {
        setIsConnected(true);
        setScreen('main');
        setSessionExpired(true);
      } else {
        setScreen('setup');
      }
    });
  }, []);

  /* ── worker broadcasts ── */
  useEffect(() => {
    const listener = (message: Message) => {
      if (message.type === 'urlTicketDetected') {
        setTicketKey(prev => {
          if (prev === message.key) return prev;
          setDetectedChip(true);
          return message.key;
        });
      } else if (message.type === 'screenshotReady') {
        setScreenshot({ dataUrl: message.dataUrl, pin: message.pin });
        setPinning(false);
        setPinError(null);
        setPostError(null);
        setPostErrorStage(null);
        setScreen('compose');
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

  /* ── detect ticket in current tab when main opens ── */
  useEffect(() => {
    if (screen !== 'main') return;
    (async () => {
      const regex = await loadTicketRegex();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const match = tab?.url?.match(regex);
      if (match) {
        setTicketKey(prev => {
          if (prev) return prev;
          setDetectedChip(true);
          return match[0];
        });
      }
    })();
  }, [screen]);

  /* ── debounced ticket validation ── */
  const validateTicket = useCallback((key: string) => {
    setTicket(null);
    setTicketError(null);
    if (!key) return;
    let plausible = TICKET_ID_REGEX.test(key);
    if (!plausible) {
      const projectRe = buildProjectRegex(pattern);
      if (projectRe) {
        plausible = new RegExp(`^(?:${projectRe.source})$`, 'i').test(key);
      }
    }
    if (!plausible) return;
    setValidating(true);
    chrome.runtime.sendMessage({ type: 'validateTicket', key }).then(result => {
      setValidating(false);
      if (result?.success && result.ticket) {
        setTicket(result.ticket);
      } else {
        setTicketError(`Ticket ${key} was not found, or you don't have access.`);
      }
    }).catch(() => {
      setValidating(false);
      setTicketError('Could not reach Jira.');
    });
  }, [pattern]);

  useEffect(() => {
    clearTimeout(validateTimer.current);
    const key = ticketKey.trim().toUpperCase();
    validateTimer.current = setTimeout(() => validateTicket(key), 350);
    return () => clearTimeout(validateTimer.current);
  }, [ticketKey, validateTicket]);

  /* ── actions ── */

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

    // Host permission must be requested from the panel (user gesture)
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) {
      setConnectError('Permission to access the Jira domain is required.');
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
      setInstanceDomain(domainOf(baseUrl.trim()));
      setSessionExpired(false);
      setIsConnected(true);
      setToken('');
      setScreen('connected-splash');
      setTimeout(() => setScreen('main'), 1400);
    } else {
      setConnectError(result?.error ?? `Could not reach ${domainOf(baseUrl)}. Check the URL and that your token has read/write scope.`);
    }
  };

  const handleDropPin = async () => {
    setPinError(null);
    setPinning(true);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setPinError('No active tab found.');
      setPinning(false);
      return;
    }

    // captureVisibleTab requires activeTab or the literal <all_urls>
    // pattern (Chromium's kActiveTabOrAllUrls check rejects scheme
    // wildcards like https://*/*). activeTab isn't granted for
    // side-panel clicks, so request <all_urls> once (one-time prompt).
    try {
      const url = new URL(tab.url);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('restricted');
    } catch {
      setPinError("Pins can't be placed on this page.");
      setPinning(false);
      return;
    }

    const granted = await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    if (!granted) {
      setPinError('Chrome needs site access to capture screenshots. Click "Drop a pin" again and choose Allow.');
      setPinning(false);
      return;
    }

    const result = await chrome.runtime.sendMessage({ type: 'startPinMode', tabId: tab.id })
      .catch(err => ({ success: false, error: String(err) }));
    if (!result?.success) {
      setPinError(result?.error ?? "Pins can't be placed on this page.");
      setPinning(false);
    }
  };

  const handleCancelCompose = () => {
    chrome.runtime.sendMessage({ type: 'cancelPin' }).catch(() => {});
    setScreenshot(null);
    setComment('');
    setPostError(null);
    setPostErrorStage(null);
    setScreen('main');
  };

  const handleRetake = () => {
    chrome.runtime.sendMessage({ type: 'cancelPin' }).catch(() => {});
    setScreenshot(null);
    setScreen('main');
    void handleDropPin();
  };

  const handlePost = async () => {
    if (!ticket || !screenshot) return;
    setPostError(null);
    setPosting(true);

    const result = await chrome.runtime.sendMessage({
      type: 'submit',
      key: ticket.key,
      comment: comment.trim() || 'Screenshot pin',
      imageDataUrl: screenshot.dataUrl,
      pin: screenshot.pin,
    }).catch(err => ({ success: false, error: String(err) }));

    setPosting(false);
    if (result?.success) {
      setScreenshot(null);
      setComment('');
      setScreen('success');
    } else {
      if (String(result?.error ?? '').includes('401')) {
        setSessionExpired(true);
        setScreen('main');
        return;
      }
      setPostError(result?.error ?? 'Something went wrong while posting.');
      setPostErrorStage(result?.stage ?? null);
    }
  };

  const handleRescan = async () => {
    if (rescanning) return;
    setScanNote(null);
    setRescanning(true);
    try {
      const regex = await loadTicketRegex();
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let found = tab?.url?.match(regex)?.[0]
        ?? tab?.title?.match(regex)?.[0]
        ?? null;

      // Fall back to scanning the page content itself (title + visible
      // text). Fails silently on restricted pages or without host access.
      if (!found && tab?.id) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (source: string) => {
              const re = new RegExp(source);
              return document.title.match(re)?.[0]
                ?? document.body?.innerText.match(re)?.[0]
                ?? null;
            },
            args: [regex.source],
          });
          found = (results[0]?.result as string | null) ?? null;
        } catch {
          // Restricted page — URL/title scan already covered what we can
        }
      }

      if (found) {
        setTicketKey(found);
        setDetectedChip(true);
      } else {
        setScanNote('No Jira ticket ID found on this page.');
      }
    } finally {
      setRescanning(false);
    }
  };

  const handleAddAnotherPin = () => {
    setScreen('main');
    void handleDropPin();
  };

  const openSettings = () => {
    setConnectError(null);
    setScreen('setup');
  };

  const handleDisconnect = async () => {
    await chrome.runtime.sendMessage({ type: 'disconnect' }).catch(() => {});
    // Keep the instance URL for easy reconnect; wipe the token.
    setIsConnected(false);
    setSessionExpired(false);
    setToken('');
    setTicket(null);
    setConnectError(null);
  };

  const handlePatternChange = (value: string) => {
    const key = value.toUpperCase();
    setPattern(key);
    if (!key.trim()) {
      setPatternError(null);
      chrome.storage.local.remove('ticketProject').catch(() => {});
      return;
    }
    if (!/^[A-Z][A-Z0-9]*-?$/.test(key.trim())) {
      setPatternError('Use your Jira space key — letters and numbers, e.g. MIST-');
      return;
    }
    setPatternError(null);
    chrome.storage.local.set({ ticketProject: key.trim() }).catch(() => {});
  };

  const maximizeScreenshot = () => {
    if (screenshot) chrome.tabs.create({ url: screenshot.dataUrl });
  };

  /* ── shared chrome ── */

  const Header = (
    <div style={{
      height: 44, padding: '0 12px 0 16px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: '1px solid var(--color-gray-200)', background: 'var(--color-gray-50)', flexShrink: 0,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-green-400)', flex: 'none' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-gray-700)',
        flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {instanceDomain}
      </span>
      <IconButton icon="Settings" size="sm" aria-label="Settings" onClick={openSettings} />
    </div>
  );

  /* ── screens ── */

  if (screen === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner light={false} size={20} />
      </div>
    );
  }

  if (screen === 'setup') {
    const showConnected = isConnected && !sessionExpired;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <div style={{ padding: '48px 24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
          <img src="icons/icon128.png" alt="Nitpick" width={48} height={48} style={{ borderRadius: 10 }} />
          <div style={{ font: '700 18px Inter,sans-serif', color: 'var(--color-gray-800)' }}>Nitpick</div>
          <div style={{ fontSize: 13, lineHeight: '20px', color: 'var(--color-gray-600)', maxWidth: 280 }}>
            Pin feedback to any webpage and post it straight to a Jira ticket.
          </div>
        </div>

        <form onSubmit={handleConnect} style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {connectError && (
            <Alert status="error" title="Connection failed">{connectError}</Alert>
          )}

          {showConnected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusTag variant="success">Connected</StatusTag>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {instanceDomain}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={label}>Jira instance URL</label>
            <Input
              type="url"
              placeholder="https://jira.mycompany.com"
              leftIcon="LucideLink2"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              isDisabled={connecting || showConnected}
              isInvalid={!!connectError}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <label style={label}>{useCloudAuth ? 'API token' : 'Personal Access Token'}</label>
              {!showConnected && (
                <a href={PAT_DOCS_URL} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>Where do I find this?</a>
              )}
            </div>
            <Input
              type={showToken && !showConnected ? 'text' : 'password'}
              placeholder="••••••••••••••••"
              leftIcon="Lock"
              rightIcon={
                !showConnected && (
                  <span onClick={() => setShowToken(v => !v)} style={{ display: 'inline-flex', cursor: 'pointer' }}>
                    <Icon name="Eye" size={16} />
                  </span>
                )
              }
              value={showConnected ? '0000000000000000' : token}
              onChange={e => setToken(e.target.value)}
              isDisabled={connecting || showConnected}
              required={!showConnected}
            />
          </div>

          {useCloudAuth && !showConnected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={label}>Email</label>
              <Input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                isDisabled={connecting}
                required
              />
            </div>
          )}

          {showConnected ? (
            <Button
              key="disconnect"
              size="md"
              variant="solid"
              colorScheme="error"
              style={{ width: '100%' }}
              onClick={e => { e.preventDefault(); void handleDisconnect(); }}
            >
              Disconnect
            </Button>
          ) : (
            <Button key="connect" type="submit" size="md" variant="solid" colorScheme="primary" style={{ width: '100%' }} isDisabled={connecting}>
              {connecting ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Spinner />Connecting…</span>
              ) : connectError ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="RefreshCw" size={14} />Retry connection</span>
              ) : 'Connect'}
            </Button>
          )}

          <div style={{ fontSize: 11, lineHeight: '16px', color: 'var(--color-gray-500)', textAlign: 'center' }}>
            Your token is stored locally in this browser and only sent to your Jira instance.
          </div>

          {!showConnected && (
            <div style={{ textAlign: 'center' }}>
              <a href="#" onClick={e => { e.preventDefault(); setUseCloudAuth(v => !v); }} style={{ fontSize: 11 }}>
                {useCloudAuth ? 'Using Data Center? Switch to a Personal Access Token' : 'Using Jira Cloud? Switch to email + API token'}
              </a>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <label style={label}>Ticket ID scan pattern</label>
              <span style={{ fontSize: 11, color: 'var(--color-gray-400)' }}>Optional</span>
            </div>
            <Input
              placeholder="e.g. MIST-"
              leftIcon="TextSearch"
              value={pattern}
              onChange={e => handlePatternChange(e.target.value)}
              isInvalid={!!patternError}
              inputStyle={{ fontFamily: 'var(--font-mono)', fontWeight: 400 }}
              spellCheck={false}
              autoComplete="off"
            />
            {patternError ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--color-error-default)' }}>
                <Icon name="TriangleAlert" size={12} />
                {patternError}
              </div>
            ) : (
              <div style={{ fontSize: 11, lineHeight: '16px', color: 'var(--color-gray-500)' }}>
                This is for the extension to automatically map the Jira ticket if your prototype webpage's URL contains the related Jira ID. It should be the name of your Jira space.
              </div>
            )}
          </div>

          {showConnected && (
            <div style={{ textAlign: 'center' }}>
              <a href="#" onClick={e => { e.preventDefault(); setScreen('main'); }} style={{ fontSize: 12 }}>
                ← Back to pinning
              </a>
            </div>
          )}
        </form>
      </div>
    );
  }

  if (screen === 'connected-splash') {
    return (
      <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', minHeight: '100vh', justifyContent: 'center' }}>
        <span style={{ color: 'var(--color-green-500)' }}><Icon name="CircleCheckSolid" size={40} /></span>
        <div style={{ font: '600 15px Inter,sans-serif', color: 'var(--color-gray-800)' }}>Connected to {instanceDomain}</div>
        <div style={{ fontSize: 12, color: 'var(--color-gray-500)' }}>Taking you to the main screen…</div>
      </div>
    );
  }

  if (screen === 'success') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {Header}
        <div style={{ padding: '56px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', flex: 1, justifyContent: 'center' }}>
          <span style={{ color: 'var(--color-green-500)' }}><Icon name="CircleCheckSolid" size={44} /></span>
          <div style={{ font: '600 15px Inter,sans-serif', color: 'var(--color-gray-800)' }}>
            Comment posted to {ticket?.key ?? 'Jira'}
          </div>
          {ticket && (
            <a href={ticket.url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              View in Jira <Icon name="ExternalLink" size={14} />
            </a>
          )}
          <Button size="md" variant="outline" colorScheme="primary" style={{ marginTop: 12 }} onClick={handleAddAnotherPin}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="MapPin" size={15} />Add another pin</span>
          </Button>
        </div>
      </div>
    );
  }

  if (screen === 'compose' && screenshot) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {Header}
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-gray-200)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--color-blue-600)' }}>{ticket?.key}</span>
          <span style={{ fontSize: 12, color: 'var(--color-gray-600)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ticket?.summary}
          </span>
          {ticket && <StatusTag variant={statusTagVariant(ticket.status)}>{ticket.status}</StatusTag>}
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
          {postError && (
            <>
              <Alert status="error" title="Couldn't post comment">
                {postError}
                {postErrorStage === 'comment' && ' Retry will only re-post the comment — the screenshot is already attached.'}
              </Alert>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" colorScheme="neutral" onClick={() => setPostError(null)}>Dismiss</Button>
                <Button size="sm" variant="solid" colorScheme="error" onClick={handlePost}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="RefreshCw" size={12} />Retry</span>
                </Button>
              </div>
              <div style={{ borderTop: '1px solid var(--color-gray-200)', paddingTop: 12, fontSize: 11, color: 'var(--color-gray-500)' }}>
                Your comment and screenshot are kept until the post succeeds.
              </div>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 6, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--color-gray-300)', background: 'var(--color-gray-50)', opacity: posting ? 0.6 : 1 }}>
              <img src={screenshot.dataUrl} alt="Screenshot with pin" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />
              <div
                onClick={maximizeScreenshot}
                title="Open full size"
                style={{
                  position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 4,
                  background: 'rgba(26,32,44,.6)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <Icon name="Maximize2" size={13} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--color-gray-500)' }}>Screenshot · pin 1</span>
              <Button size="sm" variant="ghost" colorScheme="primary" onClick={handleRetake} isDisabled={posting}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="RefreshCw" size={12} />Retake</span>
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <label style={label}>Comment</label>
            <Textarea
              rows={4}
              placeholder="Describe the issue or feedback…"
              value={comment}
              onChange={e => setComment(e.target.value)}
              isDisabled={posting}
            />
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--color-gray-200)', paddingTop: 12 }}>
            <Button size="md" variant="outline" colorScheme="neutral" onClick={handleCancelCompose} isDisabled={posting}>Cancel</Button>
            <Button size="md" variant="solid" colorScheme="primary" onClick={handlePost} isDisabled={posting || !ticket}>
              {posting ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Spinner size={13} />Posting…</span>
              ) : `Post to ${ticket?.key ?? 'Jira'}`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* main */
  const ticketInvalid = !!ticketError;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {Header}

      {sessionExpired && (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--color-gray-200)' }}>
          <Alert status="warning" title="Session expired">
            Your Personal Access Token is no longer valid. Reconnect to keep posting feedback.
          </Alert>
          <Button size="md" variant="solid" colorScheme="primary" style={{ width: '100%' }} onClick={openSettings}>
            Reconnect to {instanceDomain}
          </Button>
        </div>
      )}

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--color-gray-200)' }}>
        <label style={label}>Jira ticket</label>
        <Input
          placeholder="MIST-12345"
          leftIcon="TextSearch"
          rightIcon={
            <span
              onClick={handleRescan}
              title="Rescan the page for a ticket ID"
              style={{ display: 'inline-flex', cursor: 'pointer', color: 'var(--color-blue-500)' }}
            >
              {rescanning ? <Spinner light={false} size={14} /> : <Icon name="RefreshCw" size={14} />}
            </span>
          }
          value={ticketKey}
          onChange={e => { setTicketKey(e.target.value.toUpperCase()); setDetectedChip(false); setScanNote(null); }}
          isInvalid={ticketInvalid}
          inputStyle={{ fontFamily: 'var(--font-mono)' }}
          spellCheck={false}
          autoComplete="off"
        />

        {detectedChip && (
          <div style={{ display: 'flex' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--color-blue-50)', color: 'var(--color-blue-700)',
              borderRadius: 9999, padding: '2px 6px 2px 10px',
              fontSize: 11, fontFamily: 'Inter,sans-serif', fontWeight: 500,
            }}>
              <Icon name="LucideLink2" size={12} />
              Detected from page URL
              <span
                onClick={() => setDetectedChip(false)}
                style={{ display: 'inline-flex', padding: 2, borderRadius: '50%', cursor: 'pointer', color: 'var(--color-blue-600)' }}
              >
                <Icon name="X" size={12} />
              </span>
            </span>
          </div>
        )}

        {scanNote && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-gray-500)' }}>
            <Icon name="TextSearch" size={14} />
            {scanNote}
          </div>
        )}

        {validating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-gray-500)' }}>
            <Spinner light={false} size={12} /> Looking up ticket…
          </div>
        )}

        {ticketError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-error-default)' }}>
            <Icon name="TriangleAlert" size={14} />
            {ticketError}
          </div>
        )}

        {ticket && (
          <div style={{
            border: '1px solid var(--color-gray-200)', borderRadius: 6, padding: '10px 12px',
            display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--color-gray-50)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--color-blue-600)' }}>{ticket.key}</span>
              <StatusTag variant={statusTagVariant(ticket.status)}>{ticket.status}</StatusTag>
              <span style={{ flex: 1 }} />
              {ticket.assignee && <Avatar name={ticket.assignee} size={20} />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticket.summary}
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pinError && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-error-default)' }}>
            <Icon name="TriangleAlert" size={14} />
            {pinError}
          </div>
        )}
        <Button
          size="lg"
          variant="solid"
          colorScheme="primary"
          style={{ width: '100%' }}
          isDisabled={!ticket || pinning || sessionExpired}
          onClick={handleDropPin}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {pinning ? <Spinner size={16} /> : <Icon name="MapPin" size={18} />}
            {pinning ? 'Click the page to place…' : 'Drop a pin'}
          </span>
        </Button>
        <div style={{ fontSize: 12, lineHeight: '18px', color: 'var(--color-gray-500)', textAlign: 'center' }}>
          {!ticket && !validating
            ? 'Enter a valid ticket to start pinning.'
            : pinning
              ? 'Click anywhere on the page to place a pin. Press Esc to cancel.'
              : 'Click anywhere on the page to place a pin and capture a screenshot.'}
        </div>
      </div>

      <div style={{
        flex: 1, margin: '0 16px 16px', border: '1px dashed var(--color-gray-300)', borderRadius: 6,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, color: 'var(--color-gray-400)', minHeight: 180,
      }}>
        {pinning ? (
          <>
            <PinMarker n={1} size={26} />
            <div style={{ fontSize: 12, color: 'var(--color-gray-500)', marginTop: 8 }}>Waiting for your click…</div>
            <div style={{ fontSize: 11, color: 'var(--color-gray-400)', maxWidth: 220, textAlign: 'center' }}>
              Switch to the page and click where the issue is.
            </div>
          </>
        ) : (
          <>
            <Icon name="MapPinned" size={28} />
            <div style={{ fontSize: 12, color: 'var(--color-gray-500)' }}>No pins yet</div>
            <div style={{ fontSize: 11, color: 'var(--color-gray-400)', maxWidth: 220, textAlign: 'center' }}>
              Your pinned screenshot and comment will appear here.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
