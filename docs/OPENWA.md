# Optional WhatsApp / OpenWA setup

JARVIS includes account adapters and reviewed actions, not an existing paired number. OpenWA is a separately installed local gateway. Reads/drafts remain selected-chat only; sending requires exact account/recipient/text approval. This setup guide does not authorize sending messages.

## Install the compatible upstream source

The private installation's gateway source revision was `884d79465ea0795570806f201ffabf782ef93bd3` in [rmyndharis/OpenWA](https://github.com/rmyndharis/OpenWA), version 0.24.0. Reuse the pinned source for compatibility rather than assuming newer upstream versions have the same API and dashboard layout. The complete public-clone recipe below has not been freshly executed against a real account.

From the JARVIS repository root, with Node 24+ and Git installed:

```powershell
git clone https://github.com/rmyndharis/OpenWA.git integrations/OpenWA
git -C integrations/OpenWA checkout 884d79465ea0795570806f201ffabf782ef93bd3
npm.cmd --prefix integrations/OpenWA ci --ignore-scripts
node scripts/prepare-openwa.mjs
npm.cmd --prefix integrations/OpenWA rebuild
npm.cmd --prefix integrations/OpenWA run dashboard:ci
npm.cmd --prefix integrations/OpenWA run build:all
```

`prepare-openwa.mjs` applies the documented Windows SQLite/loopback adjustments and creates a local `.env` only if absent. It generates a random key-hashing pepper locally, not a shared published key. Do not copy `.env`, browser caches, database contents, sessions, or API keys from another installation.

The gateway uses Puppeteer. If its browser has not been installed, run its upstream-supported Puppeteer browser installation from the gateway directory with `PUPPETEER_CACHE_DIR` set to that gateway's `.browser-cache`. Preserve the upstream install/postinstall checks and consult the pinned upstream README when browser prerequisites fail; do not disable launch security or use someone else's browser profile.

## Start and connect

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-openwa.ps1
```

The supported launcher expects the local API on **127.0.0.1:2785** and dashboard on **localhost:2886**. Use the local dashboard to initialize your own gateway and inspect its session state. Once initialized, run:

```powershell
node scripts/connect-openwa.mjs
```

That explicit connector creates a JARVIS session plus role/session/IP-scoped keys and stores them in the Windows user credential vault under ignored `data/connections/whatsapp.dpapi`. The gateway admin key is read server-side, never pasted into the model or frontend. If the gateway has not yet created its local `data/.api-key`, complete its legitimate local initialization first; do not invent a key.

Open JARVIS's WhatsApp tab and pair **your own** number with the actual account-specific QR/session flow. Confirm the observed account status; a running gateway is not proof of pairing. Choose chats to permit. Add a second account only deliberately with `node scripts/connect-openwa.mjs --add-second` and keep its selections and approvals isolated.

## Stop and check

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/stop-openwa.ps1
```

The supervisor manages only its own recorded process tree and should not adopt unrelated listeners. If either expected port is occupied unexpectedly, investigate instead of terminating an unfamiliar process. A launcher may resume previously authenticated sessions; an explicit stop marker keeps automatic startup from overriding your stop choice.

Verify through JARVIS account/status screens without sending test messages. A send review binds account, exact recipient, conversation, text and expiry. Do not automatically retry an uncertain send. The repository does not create a recurring monitor or install a WhatsApp login-startup entry.
