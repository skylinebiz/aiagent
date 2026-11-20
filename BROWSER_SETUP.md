# LibreChat with an in-chat browser

This fork adds a native LibreChat Browser tool and an in-chat browser panel. It does not use MCP. The browser runs headlessly on the LibreChat server; the panel shows its live page and tab strip in the same web app. The user can open pages and tabs, click the screenshot, type into the page, or let the chat model operate it through the Browser tool.

The persistent browser profile is server-side. Every chat for the same LibreChat account shares cookies, login state, local storage, and the same tab strip. Other LibreChat accounts receive separate profiles. Browser windows are represented as tabs in the shared headless Chromium context. Project data, uploaded files, the browser profile, and MongoDB data remain on the server.

## Start with Docker on Linux

Install Docker Engine and the Docker Compose v2 plugin. In this LibreChat checkout:

```bash
cp .env.browser.example .env
nano .env                 # HTTP_PORT=3080, or your chosen host port
bash run-linux.sh
```

The first registered LibreChat account becomes the administrator. The launcher builds the modified LibreChat image locally, starts MongoDB, and stores persistent data under `data/`, `uploads/`, and `logs/` on the server. To stop it:

```bash
docker compose --env-file .env -f docker-compose.browser.yml down
```

Open `http://SERVER:HTTP_PORT`, register the single internal user, and select **Browser** from the chat tool picker or add it to a saved Agent. Open the **Browser** panel in the chat to see the server browser and its tabs. The Browser tool sends its action and page snapshot into the conversation; the panel refreshes screenshots as the page changes.

## Network access

The app uses HTTP internally. Put it behind a VPN or an HTTPS reverse proxy manager for remote use; do not publish the HTTP port directly to the public internet. If the outer proxy uses HTTPS, configure LibreChat's `SESSION_COOKIE_SECURE=true` in the compose service environment before exposing the login page.

## Shared browser behavior

- One persistent Chromium profile is created for each LibreChat account.
- All chats for an account share that profile and tab strip, so logging in once carries across chats.
- The Browser panel is available in any chat. Use **+** to create tabs and select a tab from the strip.
- The chat model can use the native Browser tool to navigate, inspect, click, type, scroll, and switch tabs.
- Uploaded files and project data stay in LibreChat's server-side storage. To upload a server file through a website, use LibreChat's shared uploads or the site's own upload UI.

## Build/runtime notes

The Docker image installs Chromium and Playwright in the LibreChat API container. The browser is headless, so no Linux desktop, X server, VNC, or Windows browser viewer is involved. Browser screenshots are fetched through LibreChat's authenticated API, not a public browser port.
