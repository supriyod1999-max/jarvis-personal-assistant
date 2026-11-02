import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Reuse an installed Chromium where available; otherwise Playwright uses its own version.
const cache = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const existing = existsSync(cache) ? readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).reverse()
  .map(n => join(cache, n, 'chrome-win64', 'chrome.exe')).find(p => existsSync(p)) : undefined;
const testPort=Number(process.env.BRAIN_TEST_PORT||14320);
export default defineConfig({
  testDir: './tests/browser', workers: 1, fullyParallel: false, timeout: 30000,
  expect: { timeout: 10000 }, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${testPort}`, headless: true, viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.BRAIN_TEST_BROWSER || existing },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/test-server.mjs', url: `http://127.0.0.1:${testPort}/api/health`, reuseExistingServer: false, timeout: 15000 },
});
