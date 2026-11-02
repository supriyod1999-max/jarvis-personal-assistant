import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).map(f => `/assets/${f}`);
const html = await readFile('dist/index.html', 'utf8');
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
await writeFile('dist/sw.js', `
const CACHE = 'second-brain-${version}';
const SHELL = ['/', '/index.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', ${assets.map(x => JSON.stringify(x)).join(',')}];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
// Activate only after an explicit navigation/update request from our own page.
// Ordinary installs keep the existing offline-shell handover behaviour.
self.addEventListener('message', event => {
  if (event.data?.type !== 'JARVIS_ACTIVATE_UPDATE') return;
  try { if (new URL(event.source.url).origin !== self.location.origin) return; } catch { return; }
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('second-brain-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/downloads/')) return;
  if (event.request.mode === 'navigate') {
    // Serve the matching shell and bundles together. A new worker takes over when old tabs close.
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')));
  } else if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
`);
console.log(`Offline app shell built (${version}).`);
