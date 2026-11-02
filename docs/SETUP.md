# Setup

## Requirements

- Windows 10/11 for the supported credential vault and launchers.
- Node.js 24 or newer and npm; Git for repository work.
- A current browser. Internet is needed to install dependencies and use external integrations.
- No AI account, GPU, phone, or messaging account is needed to use local records.

## Install

Extract or clone this public folder into a location you control. Open PowerShell there:

```powershell
node --version
npm.cmd ci
npm.cmd run build
npm.cmd start
```

Open `http://127.0.0.1:4317`. The app starts with no personal records or account connections. Use Settings to customize the profile and set your own workspace PIN. The app must not invent a PIN for you.

If another installation is running, do not stop or reuse it without intending to. Run this checkout with `$env:PORT = '14317'` before `npm.cmd start` and open `http://127.0.0.1:14317`. Desktop launchers and phone setup assume their standard ports and are not covered by this alternate-port example.

## First check

Create a task, refresh, and confirm it persists. Visit Settings and confirm optional services are disconnected or unavailable. Text capture is usable without configuring those services. Sign-in is an explicit separate step; a successful build is not account-connection proof.

## Storage and backup

`data/brain.sqlite` holds records; `data/conversations.sqlite` holds conversations. Other files in `data/` contain settings, connection material, caches, device permissions, and private integration state. Browser IndexedDB holds a local copy and queued changes. Use the app's export actions for readable backups; record export and conversation export are separate.

Do not clear browser storage while edits are waiting to sync. Do not copy SQLite files mid-write without an appropriate SQLite backup or coordinated shutdown; WAL files may be needed. Keep backups outside the repository and protect them as private data.

## Desktop shell

After the web app works at its standard port, run `npm.cmd run desktop`. The shell manages only fixed server launchers. It does not create account connections or enable wake listening automatically. `npm.cmd run desktop:package` creates a local, path-bound package in ignored `output/desktop/`; it is not a portable installer and must not be uploaded as a public release without separate packaging work.

## Startup

No startup hook is installed by the normal setup. Windows startup scripts are included for an owner who explicitly chooses to configure them. Read the scripts first; do not run them as part of unattended installation or routine tests.
