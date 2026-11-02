# Architecture

`src/` contains the React UI and device cache/synchronization logic. `shared/` defines common record validation and mutation shapes. `server/` owns SQLite persistence, authentication, account adapters, bounded AI context, reviews, and approved actions. `desktop/` is an Electron shell with a restricted native toolbar bridge. `native/` contains optional Windows helpers. `android/` contains phone/watch source. `scripts/` contains build, setup, and opt-in maintenance tools. `tests/` contains synthetic tests.

The Node server binds to loopback. Local desktop requests use Host/Origin protections; private phone traffic goes to a separate listener with an exact Tailscale owner check and application session checks. Browser code must never receive account API keys or native toolbar administrative controls.

Record saves carry operation IDs and base revisions. The store returns durable receipts, rejects revision conflicts, and supports safe replay. Browser IndexedDB retains queued changes while offline. Backups, chat persistence, record memory, and third-party account sessions are distinct stores.

AI requests include bounded recent conversation and explicitly selected or recall-enabled records. A model's proposed change is not approval. Reviews bind proposed action, exact target, text/digest, revision, conversation, and expiry as applicable. Incoming service messages are untrusted content. Personal-memory reviews, WhatsApp send reviews, and household-change reviews have separate approval semantics.

Each workspace has its own data and lock sessions. A deliberately configured secondary workspace may share the primary model connection without inheriting messaging state. Display preferences do not establish identity. The voice service selects one engine and awaits the previous worker's shutdown before loading another.
