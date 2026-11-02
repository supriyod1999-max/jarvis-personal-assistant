# Security

This is a personal self-hosted application, not a public multi-tenant service. Desktop port 4317 has local trust assumptions and must remain on loopback. Do not expose it through port forwarding, a public tunnel, or a reverse proxy. Use only the separate authenticated phone listener for private remote access.

Records, chat databases, browser caches, and JSON exports may contain sensitive information. They are not all encrypted. Credential files use the Windows user credential vault; this does not make the entire data directory safe to share. Use OS account protection, disk encryption, and private backups.

Do not post security vulnerabilities containing credentials or personal information in public issues. Once this repository is hosted, use its private **Report a vulnerability** feature if enabled. If it is unavailable, ask the maintainer for a private reporting channel without posting exploit details or private data.

If a credential is exposed, revoke or rotate it at its provider first. Removing it from the latest file does not remove it from Git history, forks, cached downloads, or artifacts. Follow the provider's recovery process and review affected sessions. Do not publish a private repository's existing history as this project's initial history.

Only the current source snapshot is maintained; there is no promised security response time or support for deployed third-party forks.
