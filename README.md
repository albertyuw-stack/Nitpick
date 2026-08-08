# Nitpick

Chrome extension that captures screenshots with a visual pin marker and posts them to a Jira ticket as a comment with the image attached.

## How it works

1. Open the side panel from the toolbar icon.
2. Connect to your Jira instance (base URL + Personal Access Token).
3. Enter a ticket ID — or let Nitpick auto-detect one from the current tab's URL.
4. Click **Drop a pin**, then click anywhere on the page. The pin is rendered on the page and captured in a viewport screenshot.
5. Write a comment and send. The screenshot is attached to the ticket and the comment embeds it inline (Data Center) along with the pin coordinates and page URL.

## Architecture

```
/src
  /sidepanel      → React side panel UI
  /background     → service worker: Jira client, screenshot capture, messaging hub
  /content        → pin overlay script (injected on demand)
  /shared         → message contracts, types, ticket-ID regex
manifest.json
```

- **All Jira network calls happen in the background service worker** — this avoids page CORS restrictions and keeps the token out of page contexts.
- **Host permissions are requested at runtime** for the specific Jira origin you enter, so the extension installs without blanket host access.
- The pin is a live DOM element at capture time, so it is burned into the screenshot naturally — no canvas compositing.

## Jira support

- **Data Center / Server (8.14+)** — primary path. Auth via Personal Access Token (`Authorization: Bearer`). Comments use wiki markup with the screenshot embedded inline (`!filename|width=600!`).
- **Jira Cloud** — fallback. Auth via email + API token (Basic). Comments are posted as ADF; the screenshot appears in the ticket's attachment strip (inline ADF media embedding is not attempted).

Deployment type is detected automatically at connect time via `GET /rest/api/2/serverInfo`.

### Failure handling

If the comment call fails after the attachment succeeded, the panel offers a **retry that only re-posts the comment** — the screenshot is not re-uploaded.

## Security notes

- Credentials are stored in `chrome.storage.local`, which is **unencrypted on disk**. This is acceptable for an internal tool but be aware of it; the token is never placed in `chrome.storage.sync`.
- The token only ever travels to the Jira origin you configured.

## Development

```bash
npm install
npm run build      # outputs the unpacked extension to dist/
npm run typecheck
```

Load `dist/` as an unpacked extension via `chrome://extensions` → Developer mode → Load unpacked.

## Known limitations

- `captureVisibleTab` captures the visible viewport only (by design — the pin is always where you clicked, in view).
- Pins can't be placed on restricted pages (`chrome://`, the Chrome Web Store, some PDF viewers); the panel shows an inline error.
- High-DPI screens attach physical-pixel screenshots; the panel preview is downscaled via CSS.
