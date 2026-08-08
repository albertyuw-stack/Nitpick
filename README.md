# Nitpick

Chrome extension that captures screenshots with a visual pin marker and posts them to a Jira ticket as a comment. Pin feedback to any webpage — the screenshot (with the pin burned in) is attached to the ticket and embedded inline in the comment, along with the pin coordinates and page URL.

---

## For end users

### Install

1. **Download the zip file** — grab `nitpick-extension.zip` from the repository's [Releases page](../../releases) if one is published, or directly from [`releases/nitpick-extension.zip`](releases/nitpick-extension.zip) in this repo.
2. **Extract** the zip into a folder. Keep the folder — Chrome loads the extension from it, so don't delete it after installing.
3. Open Chrome's extension settings at `chrome://extensions`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the extracted folder (the one containing `manifest.json`).
6. The extension installs and registers automatically. Pin the Nitpick icon from the toolbar's puzzle-piece menu for quick access.

### Connect to Jira

Click the Nitpick toolbar icon to open the side panel, enter your Jira instance URL and Personal Access Token, and click **Connect**. Chrome will ask permission to access your Jira domain — allow it.

- **Token handling** — Your Personal Access Token is stored locally in this browser only, encrypted at rest with AES-256-GCM (the encryption key is non-exportable, held in the browser's own key storage). The token only ever travels to the Jira origin you configured. For where to find/create a token, see the Jira documentation: [Personal Access Tokens (Data Center/Server)](https://confluence.atlassian.com/enterprise/using-personal-access-tokens-1026032365.html) or [API tokens (Jira Cloud)](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/) — for Cloud, use the "Using Jira Cloud?" link on the setup screen to switch to email + API token.
- **Ticket-ID scan pattern** — The plugin detects Jira ticket IDs in the page URL, tab title, or page content (e.g. a prototype URL like `.../MIST-12345/v2-New-chat.html`). In Settings (gear icon) you can optionally enter your Jira space name (e.g. `MIST-`) to narrow scanning to your space. If no ticket is found, enter the ticket ID manually — the ↻ button in the ticket field re-scans the page at any time.

### Using the plugin

1. Load the web page you want to comment on.
2. Open the plugin (click the Nitpick toolbar icon).
3. If the ticket URL or ticket ID is detected, it's filled in automatically — otherwise, enter the ticket ID. A preview card confirms the ticket.
4. Click **Drop a pin**. (First use on a site: allow Chrome's screenshot permission prompt, then click again.)
5. Click anywhere on the page where you want to add a comment — a numbered pin is placed and the visible page is captured.
6. Enter your comment in the info box.
7. Click **Post to \<ticket\>**.

That's all. Use **Add another pin** to keep going, or **Retake** / **Cancel** while composing. If posting fails after the screenshot was attached, the retry only re-posts the comment — the image is not re-uploaded.

---

## For developers

### Architecture overview

Nitpick is a Manifest V3 Chrome extension with three runtime contexts plus a shared layer. There is no backend server — the extension talks directly to your Jira instance's REST API from the background service worker (which avoids page CORS restrictions and keeps the token out of page contexts).

```
/src
  /sidepanel      → React side panel UI (frontend)
  /background     → service worker: Jira client, screenshot capture, messaging hub
  /content        → pin overlay script (injected on demand)
  /shared         → message contracts, types, ticket-ID scan pattern
manifest.json     → MV3 manifest (copied verbatim into dist/)
scripts/build.js  → build orchestrator
```

| Piece | Path | Role |
|---|---|---|
| Side panel | `src/sidepanel/` | React 18 UI. All screens (setup/settings, main, compose, success) live in `App.tsx`; `mist.tsx` holds the Mist design-system primitives (Button, Input, Alert, …); `icon-data.ts` the icon glyphs. |
| Service worker | `src/background/` | `background.ts` routes messages, injects the content script, and captures screenshots via `chrome.tabs.captureVisibleTab`. `jira-client.ts` owns every Jira REST call and credential storage. `secure-store.ts` implements the AES-GCM token encryption. |
| Content script | `src/content/content.ts` | Draws the full-viewport click-capture overlay and the numbered pin marker; reports clicks back to the worker. Plain IIFE — content scripts cannot be ES modules. |
| Shared | `src/shared/` | `types.ts` defines the typed message contract between all three contexts plus the default ticket regex; `ticket-pattern.ts` builds the scan regex from the user's configured space key. |

**Build process** — `npm run build` runs `scripts/build.js`, which executes three Vite builds (`vite.config.ts` for the panel, `vite.background.config.ts`, `vite.content.config.ts` — the worker and content script need separate non-module bundles), then copies `manifest.json` and `icons/` into `dist/`. Load `dist/` as the unpacked extension. `npm run typecheck` runs strict TypeScript checks.

```bash
npm install
npm run build      # outputs the unpacked extension to dist/
npm run typecheck
```

### Key components to understand before making changes

- **Message contract** (`src/shared/types.ts`) — every panel ↔ worker ↔ content interaction is a typed message in the `Message` union. Add new message types here first; all three contexts import it.
- **Pin → screenshot pipeline** — panel sends `startPinMode` → worker injects `content.js` → user clicks → content script places the pin marker and sends `pinPlaced` → worker waits one paint tick, calls `captureVisibleTab`, and broadcasts `screenshotReady` to the panel. The pin is a live DOM element at capture time, so it is burned into the PNG naturally — no canvas compositing.
- **Permissions model** — host permissions are optional and requested at runtime: the Jira origin on Connect, `<all_urls>` on first Drop-a-pin. Note that `captureVisibleTab` specifically requires the literal `<all_urls>` pattern (or `activeTab`) — narrower wildcards like `https://*/*` satisfy script injection but *not* capture.
- **Jira submission** (`jira-client.ts`) — two sequential calls: attach the PNG (the `X-Atlassian-Token: no-check` header is required or Jira rejects it), then post the comment through the **v2** endpoint with a wiki-markup body on both Cloud and Data Center. Cloud converts wiki markup to ADF server-side and resolves `!filename!` against the issue's attachments, which is what renders the screenshot inline (v3 ADF media nodes would need an internal media UUID the public API doesn't expose). Deployment type is detected at connect time via `GET /rest/api/2/serverInfo`; Data Center authenticates with `Bearer <PAT>`, Cloud with Basic email:API-token.

### Important considerations

- **Dependency versions** — React 18, Vite 5, TypeScript 5, `@types/chrome`. The TS config is strict; newer TS versions are picky about `Uint8Array`/`ArrayBuffer` generics in WebCrypto code.
- **Build scripts** — always build through `scripts/build.js` (not `vite build` alone), or the worker/content bundles and static assets won't land in `dist/`. Bump `manifest.json` and `package.json` versions together.
- **Token handling** — the credential is stored as AES-256-GCM ciphertext in `chrome.storage.local`; the non-extractable key lives in IndexedDB (`secure-store.ts`). Never write the plaintext token to storage, logs, or error messages, and do not move it to `chrome.storage.sync`. Legacy plaintext configs migrate on first load; if the IndexedDB key is lost, the config is intentionally dropped and the user reconnects.
- **Known limitations** — `captureVisibleTab` captures the visible viewport only (by design: the pin is always where you clicked, in view). Pins can't be placed on restricted pages (`chrome://`, the Chrome Web Store, some PDF viewers); the panel shows an inline error. High-DPI screens attach physical-pixel screenshots; the panel preview is downscaled via CSS.

### Disclaimer

Modifications are at the developer's own risk. This extension handles authentication credentials and posts content to your organization's Jira instance — ensure any changes comply with your organization's licensing and security policies before distributing a modified build. See [LICENSE](LICENSE) for the project license.
