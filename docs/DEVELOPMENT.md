# Development and troubleshooting

Use Node 24+ and `npm.cmd ci` from the repository root. Run `npm.cmd test`, then `npm.cmd run build`, then browser verification. Browser tests start their own server with synthetic providers and isolated `.test-data` storage; they must not use personal records or real connected accounts.

```powershell
npx.cmd playwright install chromium
npm.cmd run test:browser
npm.cmd run audit:public
```

The public browser suite checks the fresh UI and local record flow. Private upstream household acceptance fixtures are intentionally absent. Passing public tests does not prove a live provider, signed-in household, phone, watch, GPU, Windows sign-in helper, or messaging account works.

If port 4317 is busy, choose another `PORT` for manual web testing; do not terminate an unfamiliar process. If a page reports a different store identity, export queued data before investigating. If an optional connection is unavailable, complete its own setup; never copy credentials from another installation. If speech is unavailable, use typed input while preparing the chosen local runtime. A missing model must not trigger a silent fallback.

The included packaging scripts produce local artifacts, not a reviewed public release. The source-only Android tree lacks downloaded models and native libraries by design. Do not remove integrity checks to force it through a build.

Do not paste raw debug logs or database exports into public reports. Prefer a minimal synthetic reproduction and a redacted error message. Review generated screenshots and traces locally before sharing.
