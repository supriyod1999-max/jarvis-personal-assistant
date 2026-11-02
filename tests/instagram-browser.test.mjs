import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramBrowser, savedInstagramUrl, savedLink, savedPageProblem, instagramSyncFailure } from '../server/instagram-browser.mjs';
import { createInstagram } from '../server/instagram.mjs';
import { directory } from './helpers.mjs';

const root = 'https://www.instagram.com/example/saved/';
test('Saved links support All posts, named collections and author-prefixed reels without widening navigation', () => {
  assert.equal(savedInstagramUrl('https://www.instagram.com/example_user/saved/'), 'https://www.instagram.com/example_user/saved/');
  for (const suffix of ['all-posts/', '123456/', 'ideas_2026/']) assert.equal(savedLink(root + suffix, root).collection, root + suffix);
  assert.equal(savedLink('/author.name/reel/ABCDE123/?share=secret', root).url, 'https://www.instagram.com/reel/ABCDE123/');
  for (const value of ['https://evil.test/example/saved/123/', 'https://user:secret@www.instagram.com/example/saved/123/', '/other/saved/123/', '/example/saved/123/other/', '/accounts/login/', 'javascript:alert(1)']) assert.equal(savedLink(value, root), null);
  assert.equal(savedPageProblem(root.slice(0, -1), root), null);
  assert.equal(savedPageProblem('https://www.instagram.com/accounts/login/?next=private', root), 'sign_in_required');
  assert.equal(savedPageProblem('https://www.instagram.com/challenge/secret/', root), 'security_check');
  assert.equal(savedPageProblem('https://www.instagram.com/other/saved/', root), 'saved_page_redirect');
});

function fixture({ redirect, empty = false, timeout = false } = {}) {
  let current, reads = 0, closes = 0; const visits = [];
  const page = {
    goto: async url => { if (timeout) throw Object.assign(new Error('secret upstream URL'), { name: 'TimeoutError' }); current = redirect || url; reads = 0; visits.push(url); },
    url: () => current,
    waitForTimeout: async () => {},
    locator: selector => ({ count: async () => 0, evaluateAll: async fn => {
      assert.equal(selector, 'main a[href], [role="main"] a[href]');
      reads++;
      const links = empty || reads < 4 ? [] : current === root
        ? [{ href: root + 'all-posts/', name: 'All posts' }, { href: root + '123/', name: 'Recipes' }]
        : [{ href: '/author/reel/ABCDE123/', name: '' }];
      return fn(links.map(link => ({ getAttribute: () => link.href, textContent: link.name, querySelector: () => null })));
    } }),
    evaluate: async fn => String(fn).includes('scrollHeight') ? { height: 800, bottom: true } : undefined,
    close: async () => { closes++; },
  };
  return { visits, closed: () => closes, launch: async () => ({ on: () => {}, newPage: async () => page, close: async () => {} }) };
}

test('collection scan waits for rendered content and only visits All posts', async () => {
  const f = fixture(), browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: f.launch });
  try {
    const result = await browser.collect(root);
    assert.deepEqual(f.visits, [root, root + 'all-posts/']);
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].collections, ['All posts']);
    assert.equal(result.partial, false);
    assert.equal(f.closed(), 1);
  } finally { await browser.close(); }
});

test('scan failure categories distinguish sign-in, challenge, redirect, timeout, empty layout and browser launch', async () => {
  for (const [options, code] of [
    [{ redirect: 'https://www.instagram.com/accounts/login/' }, 'sign_in_required'],
    [{ redirect: 'https://www.instagram.com/challenge/' }, 'security_check'],
    [{ redirect: 'https://www.instagram.com/' }, 'saved_page_redirect'],
    [{ empty: true }, 'saved_links_missing'], [{ timeout: true }, 'page_timeout'],
  ]) {
    const f = fixture(options), browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: f.launch });
    try { await assert.rejects(browser.collect(root), error => error.instagramCode === code); assert.equal(f.closed(), 1); }
    finally { await browser.close(); }
  }
  const browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: async () => { throw new Error('credential'); } });
  await assert.rejects(browser.collect(root), error => error.instagramCode === 'browser_unavailable');
  await browser.close();
});

test('safe diagnostic persists across restart without leaking arbitrary browser errors or erasing saved setup', async t => {
  const path = directory(t); let error = Object.assign(new Error('private cookie'), { instagramCode: 'saved_links_missing' });
  const options = { directory: path, timers: false, browser: { collect: async () => { throw error; }, close: async () => {} } };
  let app = createInstagram(options);
  app.configure({ savedUrl: root, daily: true, analyse: true });
  await app.sync(); assert.match(app.status().message, /could not find collection or reel links/);
  await app.close(); app = createInstagram(options);
  try {
    assert.match(app.status().message, /could not find collection or reel links/);
    assert.equal(app.status().daily, true); assert.equal(app.status().analyse, true); assert.equal(app.status().savedUrl, root);
    error = Object.assign(new Error('https://private.test/?cookie=secret'), { instagramCode: 'constructor' });
    await app.sync(); assert.doesNotMatch(app.status().message, /secret|private\.test|cookie/);
    assert.equal(instagramSyncFailure(error).code, 'page_read_failed');
  } finally { await app.close(); }
});

function scrollingFixture(lists) {
  let current, offset = 0, clock = 1000000;
  const scrolls = new Map();
  const page = {
    goto: async url => { current = url; offset = 0; }, url: () => current,
    waitForTimeout: async ms => { clock += ms; },
    locator: () => ({ count: async () => 0, evaluateAll: async fn => {
      const links = current === root ? Object.keys(lists).map(key => ({ href: root + key + '/', name: key }))
        : lists[current.slice(root.length).replace(/\/$/, '')].slice(offset, offset + 12).map(code => ({ href: '/reel/' + code + '/', name: '' }));
      return fn(links.map(link => ({ getAttribute: () => link.href, textContent: link.name, querySelector: () => null })));
    } }),
    evaluate: async fn => {
      if (String(fn).includes('scrollHeight')) return { height: 800, bottom: current === root || offset + 12 >= lists[current.slice(root.length).replace(/\/$/, '')].length };
      scrolls.set(current, (scrolls.get(current) || 0) + 1);
      if (current !== root) offset = Math.min(Math.max(0, lists[current.slice(root.length).replace(/\/$/, '')].length - 12), offset + 6);
    }, close: async () => {},
  };
  return { scrolls, now: () => clock, advance: ms => { clock += ms; }, launch: async () => ({ on: () => {}, newPage: async () => page, close: async () => {} }) };
}
const codes = count => Array.from({ length: count }, (_, i) => 'REEL' + String(i).padStart(5, '0'));

test('routine sync stops at the All Posts frontier and ignores category movement; explicit history scans deeper saves', async () => {
  const lists = { 'all-posts': codes(100), Recipes: codes(50) }, f = scrollingFixture(lists);
  const browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: f.launch, now: f.now });
  try {
    const first = await browser.collect(root); assert.equal(first.partial, false);
    f.scrolls.clear(); lists['all-posts'].unshift('NEWREEL1', 'NEWREEL2'); lists.Recipes.unshift('REEL00080');
    const second = await browser.collect(root, { scanState: first.scanState });
    assert.equal(second.partial, false);
    assert.equal(f.scrolls.get(root + 'all-posts/') || 0, 0);
    assert.equal(f.scrolls.get(root + 'Recipes/') || 0, 0);
    assert.ok(second.items.find(item => item.url.includes('NEWREEL1')));
    assert.equal(second.items.find(item => item.url.includes('REEL00080')), undefined);
    assert.equal(f.scrolls.has(root + 'Recipes/'), false);
    // Reordered/older changes are deliberately caught by a periodic full pass.
    lists['all-posts'].splice(30, 0, 'DEEPNEW1'); f.advance(8 * 86400000);
    const third = await browser.collect(root, { scanState: second.scanState, includeHistory: true });
    assert.ok(third.items.find(item => item.url.includes('DEEPNEW1')));
    assert.equal(third.partial, false);
  } finally { await browser.close(); }
});

test('initial import resumes beyond the old scroll cap and a lost frontier never skips unchecked new saves', async () => {
  const lists = { 'all-posts': codes(240) }, f = scrollingFixture(lists);
  const browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: f.launch, now: f.now });
  try {
    const first = await browser.collect(root); assert.equal(first.partial, true);
    assert.equal(first.scanState.pages[root + 'all-posts/'].complete, false);
    const quick = await browser.collect(root, { scanState: first.scanState });
    assert.equal(quick.partial, false); assert.equal(quick.historyPending, true);
    assert.deepEqual(quick.scanState.pages[root + 'all-posts/'].tail, first.scanState.pages[root + 'all-posts/'].tail);
    const second = await browser.collect(root, { scanState: quick.scanState, includeHistory: true });
    assert.equal(second.partial, false);
    assert.ok(second.items.find(item => item.url.includes('REEL00239')));
    const oldHead = second.scanState.pages[root + 'all-posts/'].head;
    lists['all-posts'].unshift(...codes(400).map(code => 'NEW' + code));
    const interrupted = await browser.collect(root, { scanState: second.scanState });
    assert.equal(interrupted.partial, true);
    assert.deepEqual(interrupted.scanState.pages[root + 'all-posts/'].head, oldHead);
  } finally { await browser.close(); }
});

test('items and per-collection checkpoint survive an interrupted sync together, scoped to the configured Saved root', async t => {
  const path = directory(t); let crash = true, received, downloads = 0;
  const state = { version: 1, root, pages: { [root + 'Recipes/']: { head: ['ABCDE123'], tail: ['ABCDE123'], complete: false, fullScanAt: 0 } }, nextCollection: root + 'Recipes/' };
  const options = { directory: path, timers: false, download: async () => { downloads++; return { shortcode: 'ABCDE123', sha256: 'a'.repeat(64), audioVideoDecodePassed: true }; }, browser: {
    collect: async (url, options) => {
      received = options.scanState;
      const result = { items: [{ url: 'https://www.instagram.com/reel/ABCDE123/', collections: ['Recipes'] }], scanState: state, partial: true };
      await options.onCheckpoint(result);
      if (crash) throw new Error('network interrupted');
      return result;
    }, close: async () => {},
  } };
  let app = createInstagram(options); app.configure({ savedUrl: root, daily: true });
  await app.sync(); assert.equal(app.list().length, 1); await app.close(); crash = false;
  app = createInstagram(options);
  try { await app.sync(); await app.drain(); assert.deepEqual(received, state); assert.equal(downloads, 1); assert.equal(app.list().length, 1); assert.match(app.status().message, /^0 new saved links/); }
  finally { await app.close(); }
  const f = scrollingFixture({ 'all-posts': codes(15) }), browser = createInstagramBrowser({ directory: '.test-data/unused-profile', launch: f.launch, now: f.now });
  try {
    const result = await browser.collect(root, { scanState: { ...state, root: 'https://www.instagram.com/another/saved/', pages: { [root + 'Recipes/']: { head: ['REEL00000'], complete: true, fullScanAt: f.now() } } } });
    assert.ok(result.items.find(item => item.url.includes('REEL00014')));
  } finally { await browser.close(); }
});

