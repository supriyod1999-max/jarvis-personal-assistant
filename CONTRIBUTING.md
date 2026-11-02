# Contributing

Open an issue describing the behavior you want to change before a broad rewrite. Keep pull requests focused and explain the user-visible result, tests run, and limitations.

1. Install Node 24+ and run `npm.cmd ci`.
2. Create a branch and use an empty local store.
3. Make the change without connecting real accounts or sending real messages.
4. Run `npm.cmd test`, `npm.cmd run build`, and the relevant browser checks.
5. Run `npm.cmd run audit:public` and inspect the staged diff.

Use synthetic fixtures with reserved example addresses. Do not attach private logs, screenshots, exports, personal directory paths, or credentials to issues or pull requests. Preserve review/confirmation flows and fail-closed authentication. Do not add hosted inference that requires a separate paid AI API key as a default dependency.

Contributions are submitted under this repository's MIT License. New third-party assets need their source, license, version, and redistribution rights documented.
