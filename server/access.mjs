import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function validatePrivateAccess(value) {
  if (!value || value.version !== 1 || typeof value.origin !== 'string' || typeof value.ownerLogin !== 'string') throw new Error('Invalid private access configuration.');
  const url = new URL(value.origin);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(url.hostname) || (url.port && url.port !== '8443') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Private access needs your exact Tailscale HTTPS address.');
  if (!/^[\x21-\x7e]{1,254}$/.test(value.ownerLogin) || /[,\s]/.test(value.ownerLogin)) throw new Error('A single Tailscale owner login is required.');
  const extra = value.additionalOwnerLogins || [];
  if (!Array.isArray(extra) || extra.length > 1 || extra.some(s => typeof s !== 'string' || !/^[\x21-\x7e]{1,254}$/.test(s) || /[,\s]/.test(s))) throw new Error('Use exact additional owner identities only.');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Invalid private access port.');
  return { version: 1, origin: url.origin, ownerLogin: value.ownerLogin, port: value.port, ...(extra.length ? { additionalOwnerLogins: extra } : {}) };
}

export function loadPrivateAccess(directory) {
  const path = join(directory, 'private-access.json');
  if (!existsSync(path)) return { config: null, error: false };
  try { return { config: validatePrivateAccess(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))), error: false }; }
  catch { return { config: null, error: true }; }
}

// Serve strips client-supplied identity headers and adds verified tailnet identity.
// This check is ONLY used on a dedicated loopback listener. Never expose it on a LAN.
// The regular local listener cannot be selected by changing the forwarded Host header.
export function privateRequestAllowed(req, config) {
  if (!config || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  if (![config.ownerLogin, ...(config.additionalOwnerLogins || [])].includes(req.headers['tailscale-user-login'])) return false;
  const hostname = new URL(config.origin).host;
  // Go's standard reverse proxy preserves the incoming Host. Also accept the
  // exact backend Host for Serve versions that rewrite it; identity is still mandatory.
  if (![hostname, ...(!new URL(config.origin).port ? [`${hostname}:443`] : []), `127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(req.headers.host)) return false;
  if (req.headers.origin && req.headers.origin !== config.origin) return false;
  if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.origin) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  return true;
}

export function loginStartupInstalled() {
  return process.platform === 'win32' && !!process.env.APPDATA && existsSync(join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Second Brain.lnk'));
}
