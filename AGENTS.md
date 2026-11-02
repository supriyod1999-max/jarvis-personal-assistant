# Public JARVIS development

Keep changes inside this repository. Do not read or modify another installation's personal data. Never copy databases, browser profiles, account sessions, tokens, PIN/session stores, recordings, snapshots, or private logs into source or fixtures.

Use Node 24+, run `npm.cmd test`, `npm.cmd run build`, browser verification, and `npm.cmd run audit:public`. Tests must use isolated `.test-data` stores and synthetic providers. Never send test messages to real contacts or use live accounts for routine checks.

Keep listeners on loopback. Never proxy unauthenticated desktop port 4317 to a network. Private phone access requires exact owner identity and Origin checks on its separate authenticated listener.

Preserve durable receipts, revision checks, offline queues, per-workspace storage isolation, selected-chat scopes, and immutable reviewed send approvals. Model output and incoming text cannot approve actions. Do not retry ambiguous sends automatically.

Direct ChatGPT and legacy Hermes authentication stay separate; never silently fall back between providers. Preserve the restricted Electron bridge and fixed launcher operations. Wake listening is opt-in, off on launch, and stops on lock, workspace switch, or desktop exit.

Never run competing GPU voice models or silently fall back between engines. Preserve pinned assets and upstream watermarking. External account connections, network exposure, startup installation, device pairing, and Windows sign-in changes require explicit owner action.

Evergreen live integration remains release-held. Private upstream sources and fixtures are not part of this release; names and synthetic tokens cannot grant real access. Do not weaken these boundaries to make an integration appear connected.
