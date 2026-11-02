// Local Windows installation adjustments, kept outside the upstream checkout.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
const root = resolve(fileURLToPath(new URL('../integrations/OpenWA', import.meta.url)));
const sqlitePath = join(root, 'node_modules/better-sqlite3/package.json');
const sqlite = JSON.parse(readFileSync(sqlitePath, 'utf8'));
if (process.platform === 'win32' && sqlite.version === '13.0.3') {
  // This release ships N-API binaries but no install script, so npm's implicit
  // node-gyp rebuild runs unnecessarily. Verify the shipped binary instead.
  sqlite.scripts.install = 'node -e "new (require(\'./\'))(\':memory:\').close()"';
  writeFileSync(sqlitePath, JSON.stringify(sqlite, null, 2) + '\n');
}
const mainPath = join(root, 'src/main.ts'); const main = readFileSync(mainPath, 'utf8');
if (main.includes('await app.listen(port);')) writeFileSync(mainPath, main.replace('await app.listen(port);', "await app.listen(port, process.env.BIND_HOST || '127.0.0.1');"));
const vitePath = join(root, 'dashboard/vite.config.ts'); const vite = readFileSync(vitePath, 'utf8');
writeFileSync(vitePath, vite.replaceAll("target: 'http://localhost:2785'", "target: 'http://127.0.0.1:2785'"));
const envPath = join(root, '.env');
if (!existsSync(envPath)) writeFileSync(envPath, `# Local personal instance. Keep this file private.
NODE_ENV=development
PORT=2785
BIND_HOST=127.0.0.1
BASE_URL=http://127.0.0.1:2785
DASHBOARD_URL=http://localhost:2886
CORS_ORIGINS=http://localhost:2886,http://127.0.0.1:2886,http://127.0.0.1:2785
DATABASE_TYPE=sqlite
DATABASE_LOGGING=false
ENGINE_TYPE=whatsapp-web.js
SESSION_DATA_PATH=./data/sessions
PUPPETEER_CACHE_DIR=./.browser-cache
PUPPETEER_HEADLESS=true
AUTO_START_SESSIONS=false
REDIS_ENABLED=false
QUEUE_ENABLED=false
CACHE_ENABLED=false
POSTGRES_BUILTIN=false
MINIO_BUILTIN=false
STORAGE_TYPE=local
STORAGE_LOCAL_PATH=./data/media
UPDATE_CHECK_ENABLED=false
API_KEY_PEPPER=${randomBytes(32).toString('hex')}
`, { mode: 0o600 });
console.log('OpenWA prepared: loopback-only API, local storage, random key hashing pepper, no automatic WhatsApp session starts.');
