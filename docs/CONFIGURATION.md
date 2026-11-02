# Configuration

Configuration is local to each installation. No original account identity, private route, PIN, device pairing, voice reference, or credential file is included.

| Variable | Meaning |
| --- | --- |
| `PORT` | Desktop API/UI port; default 4317; always loopback |
| `BRAIN_DATA_DIR` | Advanced storage override; otherwise repository `data/` |
| `NODE_ENV=development` | Enables the development frontend Origin allowlist |
| `JARVIS_VOICE_STANDBY=1` | Explicitly warm the selected installed voice/input workers on startup |
| `JARVIS_AGENT_TOWN_SNAPSHOT` | Absolute path to an independently configured filtered snapshot |
| `BRAIN_TEST_PORT` | Isolated browser-test port; default 14320 |
| `BRAIN_TEST_BROWSER` | Optional installed Chromium executable for tests |
| `BRAIN_HERMES_EXECUTABLE` | Optional explicit legacy Hermes executable |

`.env.example` is a reference, not a loaded configuration file. Set variables in PowerShell or deliberately use Node's `--env-file=.env` option. Never commit a populated `.env`.

Settings are normally created by the app. `data/voice-output.json` records the shared voice selection and revision. `data/private-access.json` contains your private phone route and exact Tailscale login identity. `data/instances.json` can describe a second isolated workspace; do not copy another person's instance file. Secondary account/WhatsApp selections remain separate. These files must remain private.

Display names and honorifics are preferences, never authorization. Keep exact Tailscale identity, Origin, PIN/session, grant, and device checks. Do not replace identity checks with names or broad wildcard allowlists.

The public default profile uses a generic name. The Android source uses a new generic application namespace, so it will not be an in-place update for the original private application. Its example Tailscale address is a placeholder that must be replaced through the connection UI with your own address.
