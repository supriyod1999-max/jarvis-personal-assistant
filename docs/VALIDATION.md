# Export validation

Prepared and checked locally on 2 November 2026 with Node 24.15.0 on Windows.

| Check | Result |
| --- | --- |
| Fresh dependency installation | Passed using `npm.cmd ci` |
| Included Node tests | 250 passed, 0 failed, 0 skipped |
| Production build | TypeScript and Vite build passed |
| Isolated browser checks | 3 passed: fresh empty state, durable record replay/render/reload, explicit unavailable Agent Town state |
| Public-file audit | Passed; prospective Git files scanned |
| Independent Gitleaks 8.30.1 scan | No secrets found in the proposed public source snapshot |
| Production dependency audit | 0 reported advisories |
| Full dependency audit | 9 advisories: 5 moderate, 4 high, in development/build tooling |

Windows file-link tests and browser launching required normal execution permissions in the preparation environment. A restricted execution attempt failed on file links; the full unrestricted synthetic test run passed. No real messaging sends or live account connections were used for these checks.

Dependency advisory remediation remains separate follow-up work before distributing packaged binaries. Native Android/Wear builds, voice runtime installation, physical devices, Windows sign-in enrollment, live provider sign-in, third-party messaging, phone routing, and hosted deployment were not validated by this source preparation.

The clean scans apply to the reviewed source snapshot and do not prove the absence of every possible private fact or secret format. Rerun both secret checks and a staged-content review before publishing and after later changes.

The expanded documentation adds reviewed synthetic desktop/mobile/voice-settings screenshots and dedicated desktop, Android, Wear OS, speech, and OpenWA setup guides. The build and three browser checks were rerun after the screenshot capture change. The new Android asset downloader passed Python compilation and verified its manifest against the existing public upstream assets read-only; a fresh network download and native Gradle build remain unverified. Its pinned model/engine files are fetched separately and stay out of Git.
