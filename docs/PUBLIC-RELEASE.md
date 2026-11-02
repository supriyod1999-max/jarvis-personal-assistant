# Public-release boundary

Prepared 2 November 2026 as a new source snapshot. No private Git history was copied. Publication is a separate owner action.

## Excluded

- All `data/`, including records, chats, people, PIN/session stores, OAuth material, account configuration, device identities, grants, private routes, backups, voice references, caches, and receipts.
- Downloaded integrations, virtual environments, model assets, account browser profiles, and messaging sessions.
- `output/`, screenshots, test artifacts, recordings, crash/replay logs, attachments, caches, dependencies, generated `dist/`, Android builds, local SDK settings, installers, and APKs.
- The private workspace's AGENTS instructions, historical docs, handoffs, website, compiled Agent Town bundle/fonts, copied Evergreen upstream fixtures, and tests that require those private fixtures.
- Machine-bound desktop runtime configuration and the original repository history.

The review deliberately avoided opening personal databases, PIN stores, tokens, private sessions, backups, or recordings. Their entire storage trees were excluded instead of attempting field-by-field redaction.

The three intentional screenshots under `docs/images/` show only an isolated synthetic browser store. Original/private screenshots remain excluded. Static Android license notices, wake keywords and checksum metadata are included so owners can fetch and verify public upstream model/runtime assets; downloaded binaries remain ignored.

## Changed in public source

Personal profile defaults, contact examples, account examples, embedded private route/address, personal Android namespace, and machine-specific paths were replaced with generic values. The optional household production endpoint is an inert example domain. The Agent Town tab explicitly describes its missing separate bundle. Voice standby is opt-in for this release, so a fresh text-only setup does not attempt to preload models. Kokoro setup locates its own explicit uv/Python installation rather than depending on a private-machine tool path.

## Repeat before publishing

Run `npm.cmd run audit:public`. It scans prospective Git files, refuses runtime/private file types and linked files, checks common credential signatures, and prints paths and rule names without secret values. It is a targeted safeguard, not a proof that every possible personal identifier or secret format is detectable.

Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/scan-secrets.ps1` for the independent Gitleaks scan. It downloads a pinned, checksum-verified scanner into ignored output storage and scans only the prospective public Git files locally. CI runs both checks. No source is uploaded to a scanning service.

The scanner retains its default rules. Its only project allowlist is the exact public SHA-256 of the reviewed wake vocabulary file, which the generic key rule otherwise mistakes for a credential. No directories, credential formats, or arbitrary values are exempted.

Inspect `git status --short`, `git diff --cached --stat`, and the staged content. Confirm tests contain synthetic data only. Enable hosting secret scanning/push protection where available. Do not later copy private source directories wholesale over this folder.

The preparation audit and validation evidence are separate from account security, live-integration acceptance, third-party service availability, dependency vulnerability scanning, licensing clearance for binary distributions, and physical-device tests. A clean scan cannot guarantee that no secret exists in all future changes.


