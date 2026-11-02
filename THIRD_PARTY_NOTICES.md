# Third-party components

The root MIT License covers project-authored source. It does not replace the licenses or terms of other software, models, services, or brands.

The JavaScript dependency graph is pinned in `package-lock.json`, including React, Vite, Electron, Playwright, Lucide, TypeScript, and Zod. Inspect installed package license files before redistributing a packaged build. Native/Android dependencies are declared in their build files and have their own terms.

The export intentionally omits downloaded dependencies, Agent Town compiled bundles and fonts, copied private Evergreen fixtures, OpenWA source/runtime, speech model weights, speech reference audio, native engine binaries, Android model assets, and application packages. These exclusions avoid assuming redistribution rights or bundling private runtime state.

Optional setup scripts reference separately acquired software and models, including Whisper/OpenWhispr, Kokoro, sherpa-onnx, Chatterbox, and OpenWA. Review each upstream license and service terms before downloading, using, packaging, or redistributing them. Preserve Chatterbox watermarking. Hash pins establish integrity, not licensing rights.

Before a binary release, inventory every bundled asset and dependency and ship the required licenses and notices. This source export has not cleared a combined binary distribution for publication.
