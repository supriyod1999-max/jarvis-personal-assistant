# Publish this folder to GitHub

This folder is a separate repository with new history. Nothing here authorizes uploading the original private workspace, existing account data, or local build artifacts.

1. Read `docs/PUBLIC-RELEASE.md`, run `npm.cmd run audit:public`, and run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/scan-secrets.ps1`.
2. Run the documented tests and build. Review the resulting validation notes.
3. Inspect `.gitignore`, `git status --short`, and every file you intend to commit. Confirm there is no populated `.env`, private data, account session, local runtime configuration, model, installer, or screenshot.
4. Create an empty GitHub repository under your account. Suggested name: **jarvis-personal-assistant**. Suggested description: **A local-first personal assistant with reviewed actions and optional private integrations.** Choose public only when your review is complete. Do not import private history.
5. In this folder, stage and review the snapshot:

```powershell
git add .
git diff --cached --stat
npm.cmd run audit:public
git commit -m "Initial sanitized JARVIS source release"
```

6. Add the exact remote URL GitHub gives you, then push `main` yourself after the final review. No remote or push is configured automatically by preparation.
7. Enable private vulnerability reporting and available secret scanning/push protection in the repository settings. Keep CI test artifacts private unless inspected for disclosure.

Suggested topics: `personal-assistant`, `local-first`, `react`, `typescript`, `electron`, `sqlite`, `self-hosted`.

MIT is selected for project-authored code. Retain third-party notices and perform a separate dependency/asset licensing review before publishing packaged applications. Do not attach any artifact from the private installation to a release.

