import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePrivateAccess } from '../server/access.mjs';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'data');
const configPath = resolve(directory, 'private-access.json');
const executable = process.platform === 'win32' ? 'C:\\Program Files\\Tailscale\\tailscale.exe' : 'tailscale';
async function tailscale(args) {
  const { stdout } = await exec(executable, args, { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

export function configFromStatus(status) {
  if (status.BackendState !== 'Running' || !status.Self?.DNSName || status.Self.Tags?.length) throw new Error('Sign into Tailscale on this PC with your personal account first.');
  const owner = status.User?.[String(status.Self.UserID)]?.LoginName;
  return validatePrivateAccess({ version: 1, origin: `https://${status.Self.DNSName.replace(/\.$/, '')}`, ownerLogin: owner, port: 4318 });
}

export function routeOwned(config, serve) {
  const host = `${new URL(config.origin).host}:443`;
  const handlers = serve.Web?.[host]?.Handlers;
  return !!(serve.TCP?.['443']?.HTTPS && handlers?.['/']?.Proxy === `http://127.0.0.1:${config.port}` && !serve.AllowFunnel?.[host]);
}

async function main() {
  const command = process.argv[2] || 'status';
  if (!['prepare', 'enable', 'status', 'disable'].includes(command)) throw new Error('Use prepare, enable, status or disable.');
  if (command === 'prepare') {
    const config = configFromStatus(JSON.parse(await tailscale(['status', '--json'])));
    if (existsSync(configPath)) {
      const old = validatePrivateAccess(JSON.parse(readFileSync(configPath, 'utf8')));
      if (old.ownerLogin !== config.ownerLogin) throw new Error('The Tailscale account changed. Review the existing owner before replacing phone access.');
    }
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${configPath}.tmp`, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${configPath}.tmp`, configPath);
    console.log(JSON.stringify({ state: 'prepared', phoneUrl: config.origin, next: 'Restart Second Brain, then enable the private route.' }));
    return;
  }
  if (!existsSync(configPath)) throw new Error('Run prepare after signing into Tailscale.');
  const config = validatePrivateAccess(JSON.parse(readFileSync(configPath, 'utf8')));
  const status = JSON.parse(await tailscale(['status', '--json']));
  const current = configFromStatus(status);
  if (current.origin !== config.origin || current.ownerLogin !== config.ownerLogin) throw new Error('Tailscale identity changed. Private access needs review.');
  const serve = JSON.parse(await tailscale(['serve', 'status', '--json']));
  if (command === 'status') {
    console.log(JSON.stringify({ state: routeOwned(config, serve) ? 'enabled' : 'not-enabled', phoneUrl: config.origin, tailscale: status.BackendState }));
    return;
  }
  if (command === 'disable') {
    if (!routeOwned(config, serve)) throw new Error('This route is not owned by Second Brain. Nothing was changed.');
    await tailscale(['serve', '--bg', '--https=443', '--set-path=/', 'off']);
    console.log('Private phone route disabled. Local data and desktop access remain available.');
    return;
  }
  const host = `${new URL(config.origin).host}:443`;
  if ((serve.TCP?.['443'] || serve.Web?.[host] || serve.AllowFunnel?.[host]) && !routeOwned(config, serve)) throw new Error('HTTPS port 443 already serves something else. Nothing was replaced.');
  const local = await fetch('http://127.0.0.1:4317/api/access', { signal: AbortSignal.timeout(5000) });
  const localStatus = await local.json();
  if (localStatus.state !== 'configured' || localStatus.phoneUrl !== config.origin) throw new Error('Restart Second Brain to load private access before enabling its route.');
  const denied = await fetch(`http://127.0.0.1:${config.port}/api/state`, { signal: AbortSignal.timeout(5000) });
  if (denied.status !== 403) throw new Error('The private listener did not deny an anonymous request. No route was enabled.');
  await tailscale(['serve', '--bg', '--https=443', `http://127.0.0.1:${config.port}`]);
  const verified = JSON.parse(await tailscale(['serve', 'status', '--json']));
  if (!routeOwned(config, verified)) throw new Error('The private route could not be verified.');
  console.log(JSON.stringify({ state: 'enabled', phoneUrl: config.origin, persistent: true }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
