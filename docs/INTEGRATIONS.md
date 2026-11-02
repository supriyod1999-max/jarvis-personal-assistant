# Optional integrations

The local records app is the supported starting point. Integrations are separate opt-in setup projects. This source export does not carry a signed-in account or prove that any third-party flow works for a new user.

## AI conversations

The app implements a direct ChatGPT OAuth connection using its own registration, PKCE/state/nonce checks, and the Windows credential vault. In Settings, choose the direct ChatGPT connection and complete the external sign-in yourself. Check the displayed status and available model picker before relying on it. The implementation requests plan-backed access; provider authorization, model availability, and registration compatibility must be verified for your own account. Historical model identifiers in the source are not a compatibility guarantee.

Tokens stay server-side in ignored encrypted credential files. Do not copy tokens from another app or share its credentials. Legacy Hermes is separate and must be configured/authenticated independently; it is not a silent fallback after direct failure. Computer-task handoff only prepares editable text for copying.

## Local speech

Follow the complete [local voice setup guide](VOICE-SETUP.md) for CPU/GPU Kokoro, Chatterbox, Whisper, checks, and current CUDA runtime prerequisites. No voice weights, Python environment, GPU libraries, recordings, or reference voice are shipped. The scripts install Python 3.11.15 into ignored local storage and preserve package/model pins. This export does not install GPU drivers.

Whisper input uses `scripts/setup-input.ps1` to copy the local runtime from an installed OpenWhispr and checks the Base model hash. It expects a downloaded model in OpenWhispr's cache. Do not restore browser SpeechRecognition as a fallback. Chatterbox is an explicit alternative requiring its own environment and an owner-supplied permitted reference; no private reference audio is included. Do not run competing voice models on the GPU.

Use Settings to select an installed engine and **Apply & restart voice**. Only that selected engine should warm. Wake listening is off on launch. Speech and GPU setup have not been freshly installed or device-validated as part of this source export.

## WhatsApp

Follow the pinned-source [OpenWA setup guide](OPENWA.md). OpenWA must be installed separately in ignored `integrations/OpenWA/`. No upstream checkout, API key, session, QR pairing, contact list, message history, selected-chat configuration, monitor cursor, or approval state is included. The guide records a compatible source revision and install sequence; this export has not freshly executed a complete new gateway installation or paired a live account.

Pair your own account explicitly. Select the chats you allow. Reads/drafts stay selected-chat only. Sending needs a separate approval bound to exact account, recipient, conversation, and immutable reviewed text. A bare yes to a memory proposal cannot approve a send. Never send test messages to real contacts; ambiguous sends are not retried automatically. No recurring monitor is installed by this repository.

## Private phone access

Use your own Tailscale account on both devices. `node scripts/phone-access.mjs prepare` derives the private route and exact owner identity from your signed-in Tailscale state and writes ignored configuration. Restart JARVIS, then deliberately run `node scripts/phone-access.mjs enable`. Use `status` to inspect and `disable` to remove its owned route. Read the script before enabling; these commands change local private routing only when you run them.

Serve must target the authenticated listener on **127.0.0.1:4318**, never desktop port 4317. Do not enable public Funnel or replace an existing route owned by another app. Keep identity and Origin checks exact. A second workspace needs its own private listener and route configuration.

## Android, Wear OS, native Windows helpers

See the dedicated [desktop](DESKTOP.md), [Android](ANDROID.md), and [watch](WATCH.md) guides. The public namespace is `org.jarvisassistant.app`. Android uses SDK 36, Android Gradle Plugin 8.13.0 and Gradle 8.14.3. `scripts/setup-android-assets.py` obtains and checks pinned upstream wake/music models and sherpa engine after you opt in. Static notices and checksum metadata are included; downloaded models, the wrapper JAR and sherpa AAR remain excluded from Git. Prepare the toolchain and run all existing asset checks before building; do not disable them.

Windows remote-control and sign-in helper source needs its own native toolchain and security review. Do not run sign-in enrollment, installer, permission-repair, or registry scripts during routine setup. No Windows sign-in provider, device enrollment, or remote-control permission is installed by this export.

## Other connections

Instagram needs explicit account login and its optional media dependencies. No browser profile or saved-page identity is shipped. Agent Town's separate compiled world is excluded and its tab says so; its reader remains read-only. Evergreen stays release-held with an inert example production endpoint, no live release configuration, and no private upstream fixtures. Do not treat these adapters as connected services. No email or calendar account is configured by this repository.
