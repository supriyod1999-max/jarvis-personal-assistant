import { join } from 'node:path';

const SYNC_ERRORS = Object.freeze({
  sign_in_required: 'Instagram redirected the Saved page to sign-in. Open the dedicated Instagram window and sign in there.',
  security_check: 'Instagram requires a security check. Complete it in the dedicated Instagram window before syncing again.',
  saved_page_redirect: 'Instagram opened a different page instead of the configured Saved page. Check that this Saved address belongs to the signed-in account.',
  saved_links_missing: 'The Saved page opened, but JARVIS could not find collection or reel links. The page may still be loading, be empty, or use a layout the importer does not support.',
  page_timeout: 'Instagram did not finish loading the Saved page within 30 seconds. Try the sync again when the page loads normally.',
  browser_unavailable: 'JARVIS could not open its dedicated Instagram browser. Close that dedicated window and try Open Instagram sign-in again.',
  page_read_failed: 'JARVIS could not read the Instagram page during the scan. Reopen the dedicated Instagram window and retry.',
  all_posts_missing: 'The Saved page opened, but JARVIS could not find the All Posts tab. Open Saved and check that All Posts is visible.',
});
const syncError = code => Object.assign(new Error(SYNC_ERRORS[code]), { instagramCode: code });
export function instagramSyncFailure(error) {
  const code = Object.hasOwn(SYNC_ERRORS, error?.instagramCode) ? error.instagramCode : 'page_read_failed';
  // Never persist browser exception text: it can include cookies, signed URLs or page data.
  return { code, message: `${SYNC_ERRORS[code]} Existing saved reels are kept.` };
}

export function savedPageProblem(value, root) {
  let current; try { current = new URL(value); } catch { return 'saved_page_redirect'; }
  if (current.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(current.hostname)) return 'saved_page_redirect';
  if (/^\/accounts\/login(?:\/|$)/.test(current.pathname)) return 'sign_in_required';
  if (/^\/(?:challenge|checkpoint)(?:\/|$)/.test(current.pathname)) return 'security_check';
  const path = current.pathname.replace(/\/$/, '') + '/';
  return path.startsWith(new URL(root).pathname) ? null : 'saved_page_redirect';
}

export function savedLink(value, root) {
  let target; try { target = new URL(value, root); } catch { return null; }
  if (target.protocol !== 'https:' || !['www.instagram.com', 'instagram.com'].includes(target.hostname) || target.port || target.username || target.password) return null;
  const path = target.pathname.replace(/\/$/, '') + '/';
  const rootPath = new URL(root).pathname;
  if (path.startsWith(rootPath) && /^[A-Za-z0-9_-]{1,100}\/$/.test(path.slice(rootPath.length))) return { collection: `https://www.instagram.com${path}` };
  const match = path.match(/^\/(?:[A-Za-z0-9_.]{1,30}\/)?(?:reel|p)\/([A-Za-z0-9_-]{5,32})\/$/);
  return match ? { code: match[1], url: `https://www.instagram.com/reel/${match[1]}/` } : null;
}

export function savedInstagramUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Paste your Instagram Saved page address.'); }
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/[A-Za-z0-9_.]{1,30}\/saved\/$/.test(url.pathname)) throw new Error('Use https://www.instagram.com/yourusername/saved/ from your own profile.');
  return `https://www.instagram.com${url.pathname}`;
}

export function createInstagramBrowser({ directory, launch, now = Date.now } = {}) {
  let context, opening, closed = false;
  async function open(visible = false) {
    if (closed) throw new Error('Instagram is shutting down.');
    if (context) return context;
    if (opening) return opening;
    opening = (async () => {
      const start = launch || (await import('playwright')).chromium.launchPersistentContext.bind((await import('playwright')).chromium);
      const value = await start(join(directory, 'browser'), { channel: 'chrome', headless: !visible, acceptDownloads: false, viewport: { width: 1200, height: 850 } });
      if (closed) { await value.close(); throw new Error('Instagram is shutting down.'); }
      context = value;
      value.on('close', () => { if (context === value) context = null; });
      return value;
    })().finally(() => { opening = null; });
    return opening;
  }
  async function signIn() {
    // Switch a background context to a visible window without sharing another profile.
    if (context) await context.close();
    const session = await open(true);
    const page = session.pages()[0] || await session.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.bringToFront();
    return { state: 'sign_in', message: 'Sign in in the dedicated Chrome window, then enter your Saved page address here.' };
  }
  async function collect(savedUrl, { scanState, onCheckpoint, includeHistory = false } = {}) {
    const root = savedInstagramUrl(savedUrl);
    const previous = scanState?.version === 1 && scanState.root === root ? scanState : { pages: {} };
    const pages = { ...previous.pages };
    let page;
    try { const session = await open(false); page = await session.newPage(); }
    catch { throw syncError('browser_unavailable'); }
    const deadline = now() + 180000;
    let bounded = false;
    const items = new Map(), collections = new Map();
    async function visit(url, collection, discovery = false) {
      const old = pages[url];
      // History work is explicit; normal daily sync never becomes a deep rescan.
      const reconcile = includeHistory && !!old?.complete;
      const oldHead = new Set(old?.head || []), oldTail = new Set(reconcile ? [] : old?.tail || []);
      const seen = new Set(), orderedCodes = [], headHits = new Set(), tailHits = new Set();
      let frontierReached = !oldHead.size, tailReached = !oldTail.size, newSteps = 0, complete = false, stoppedAtFrontier = false;
      const pageDeadline = Math.min(deadline, now() + (includeHistory || reconcile ? 180000 : 35000));
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(1, Math.min(30000, deadline - now())) }); }
      catch (error) { throw syncError(error?.name === 'TimeoutError' ? 'page_timeout' : 'page_read_failed'); }
      const anchors = page.locator('main a[href], [role="main"] a[href]');
      for (let attempt = 0; attempt < 20 && now() < pageDeadline; attempt++) {
        const problem = savedPageProblem(page.url(), root);
        if (problem) throw syncError(problem);
        if (await page.locator('input[name="username"], input[name="password"]').count()) throw syncError('sign_in_required');
        const hrefs = await anchors.evaluateAll(nodes => nodes.map(a => a.getAttribute('href')));
        if (hrefs.some(href => savedLink(href, root))) break;
        await page.waitForTimeout(500);
      }
      let unchanged = 0, lastSignature = '', touched = false;
      // Deep history must be loaded by scrolling from the top; replay is bounded by time,
      // not the old 30-scroll cap, so a saved tail can advance on later runs.
      for (let n = 0; n < 2000 && now() < pageDeadline; n++) {
        const problem = savedPageProblem(page.url(), root);
        if (problem) throw syncError(problem);
        const links = await anchors.evaluateAll(nodes => nodes.map(a => ({ href: a.getAttribute('href'), name: a.textContent?.trim() || a.querySelector('img')?.alt || '' })));
        for (const link of links) {
          const target = savedLink(link.href, root);
          if (target?.collection && discovery) { collections.set(target.collection, link.name.slice(0, 200) || 'Unnamed collection'); touched = true; }
          if (discovery) continue;
          if (!target?.code) continue;
          touched = true;
          const value = items.get(target.code) || { url: target.url, collections: [] };
          if (collection && !value.collections.includes(collection)) value.collections.push(collection);
          items.set(target.code, value);
          if (!seen.has(target.code)) { seen.add(target.code); orderedCodes.push(target.code); }
          if (oldHead.has(target.code)) headHits.add(target.code);
          if (oldTail.has(target.code)) tailHits.add(target.code);
        }
        if (discovery && [...collections].some(([href, name]) => href === root + 'all-posts/' || /^all posts$/i.test(name.trim()))) { complete = true; break; }
        if (headHits.size >= Math.min(6, oldHead.size)) frontierReached = true;
        if (!tailReached && tailHits.size === oldTail.size) { tailReached = true; newSteps = 0; }
        if (!discovery && old && !includeHistory && !reconcile && frontierReached) { stoppedAtFrontier = true; complete = old.complete; break; }
        const position = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, bottom: innerHeight + scrollY >= document.documentElement.scrollHeight - 8 }));
        const signature = JSON.stringify([links, position.height]);
        unchanged = signature === lastSignature && position.bottom ? unchanged + 1 : 0; lastSignature = signature;
        if (unchanged >= 3) { complete = touched; break; }
        if ((discovery || tailReached) && newSteps >= 30) break;
        await page.evaluate(() => window.scrollBy(0, Math.max(500, innerHeight * .8)));
        await page.waitForTimeout(700);
        if (discovery || tailReached) newSteps++;
      }
      if (!touched) throw syncError('saved_links_missing');
      if (!discovery) {
        // Never move the newest frontier past a gap or discard a deep anchor we didn't reach.
        const head = frontierReached || complete || !old ? orderedCodes.slice(0, 12) : old.head;
        const tail = stoppedAtFrontier ? old.tail : tailReached || complete ? orderedCodes.slice(-6) : old?.tail || [];
        pages[url] = { head, tail, complete, fullScanAt: complete && !stoppedAtFrontier ? now() : old?.fullScanAt || 0 };
      }
      if (!complete && !stoppedAtFrontier) bounded = true;
    }
    const checkpoint = async nextCollection => {
      const state = { version: 1, source: 'all-posts', root, pages, nextCollection };
      if (onCheckpoint) await onCheckpoint({ items: [...items.values()], scanState: structuredClone(state) });
      return state;
    };
    try {
      const knownAllPosts = previous.source === 'all-posts' && savedLink(previous.nextCollection, root)?.collection === previous.nextCollection && previous.pages[previous.nextCollection];
      if (!knownAllPosts) await visit(root, 'All saved', true);
      const allPosts = knownAllPosts ? [previous.nextCollection, 'All posts'] : [...collections].find(([url]) => url === root + 'all-posts/') || [...collections].find(([, name]) => /^all posts$/i.test(name.trim()));
      if (!allPosts) throw syncError('all_posts_missing');
      if (now() < deadline) await visit(allPosts[0], 'All posts'); else bounded = true;
      // Only All Posts establishes progress. Category order or movement cannot move this cursor.
      for (const key of Object.keys(pages)) if (key !== allPosts[0]) delete pages[key];
      const state = await checkpoint(allPosts[0]);
      return { items: [...items.values()], partial: bounded, historyPending: !pages[allPosts[0]]?.complete, collectionCount: 1, nextCollection: allPosts[0], scanState: state };
    } finally { await page.close(); }
  }
  return { signIn, collect, close: async () => { closed = true; await opening?.catch(() => {}); await context?.close(); } };
}
