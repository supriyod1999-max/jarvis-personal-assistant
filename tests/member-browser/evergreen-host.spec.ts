import { test, expect, type Page } from '@playwright/test';
async function unlock(page: Page) { await expect(page.getByLabel('Workspace PIN', { exact: true })).toBeVisible(); await page.getByLabel('Workspace PIN', { exact: true }).fill('839201'); await page.getByRole('button', { name: 'Unlock workspace', exact: true }).click(); }
async function say(page: Page, text: string) { await page.getByLabel('Message JARVIS').fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); await expect(page.locator('.command-core-label')).toHaveText('Ready'); return page.locator('.command-message.assistant').last(); }

test('mounted member Settings and conversation use actual authenticated routes with private exports', async ({ page, request }) => {
  await page.goto('/#/settings'); await unlock(page);
  const panel = page.getByRole('region', { name: 'Evergreen companion' });
  await expect(panel.getByRole('heading', { name: 'Evergreen · your member connection' })).toBeVisible();
  await expect(panel).toContainText('Paired. Access is checked again');
  await page.goto('/#/command'); await expect(page.locator('.command-core-label')).toHaveText('Ready');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(await say(page, 'Add an Evergreen task')).toContainText('Browser lecture');
  await expect(await say(page, 'actually make it Friday')).toContainText('Browser Friday lecture');
  await expect(await say(page, 'yes')).toContainText('confirm Evergreen change');
  await expect(await say(page, 'confirm Evergreen change')).toContainText('Saved in Evergreen');
  // Browser context API retains the actual HttpOnly PIN cookie.
  const records = await page.request.get('/api/evergreen/records?domain=tasks'); expect(records.status()).toBe(200); expect((await records.json()).records.map((r: any) => r.data.title)).toContain('Browser Friday lecture');
  expect(JSON.stringify(await (await page.request.get('/api/chat/export')).json())).not.toContain('Browser Friday lecture');
  expect((await request.post('/api/evergreen/commit', { data: {}, headers: { 'X-Second-Brain': '1' } })).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/#/settings'); await expect(panel).toContainText('Your partner’s private records stay separate');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'output/evergreen/mounted-member-settings.png' });
});

test('workspace switch revokes the prior PIN and cannot carry a reviewed Evergreen change into the peer workspace', async ({ page }) => {
  await page.goto('/#/command'); await unlock(page); await expect(page.locator('.command-core-label')).toHaveText('Ready');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(await say(page, 'Add an Evergreen task')).toContainText('Here’s your Evergreen review');
  await page.goto('/#/settings'); await page.locator('#main').getByLabel('Switch workspace', { exact: true }).selectOption('secondary');
  await expect(page).toHaveURL(/14375/); await unlock(page); await expect(page.locator('.command-core-label')).toHaveText('Ready');
  await expect(await say(page, 'confirm Evergreen change')).toContainText('Review the current Evergreen proposal');
  const peerRows = await (await page.request.get('http://127.0.0.1:14375/api/evergreen/records?domain=tasks')).json(); expect(peerRows.records).toHaveLength(0);
  expect((await page.request.get('http://127.0.0.1:14374/api/evergreen/status')).status()).toBe(401);
  await page.goto('http://127.0.0.1:14374/#/command'); await unlock(page); await expect(page.locator('.command-core-label')).toHaveText('Ready');
  await expect(await say(page, 'confirm Evergreen change')).toContainText('Review the current Evergreen proposal');
});

test('schema4 Settings copy presents all-module scope without claiming unrestricted access', async ({ page }) => {
  // Presentation-only schema4 status fixture; live service acceptance is separate.
  await page.route('**/api/evergreen/status', async route => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const state = await response.json();
    await route.fulfill({ response, json: { ...state, moduleAccess: { boundary: 'household-module-access-v1' } } });
  });
  await page.goto('/#/settings'); await unlock(page);
  const panel = page.getByRole('region', { name: 'Evergreen companion' });
  await expect(panel).toContainText('Evergreen module connection');
  await expect(panel).toContainText('Purchases and ledger repayments require finance permissions');
  await expect(panel).not.toContainText('tasks and planner only');
  await expect(panel).toContainText('Your partner’s private records stay separate');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.screenshot({ path: 'output/evergreen/schema4-member-settings.png' });
});
