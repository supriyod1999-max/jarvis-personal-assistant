import { test, expect } from '@playwright/test';

test('fresh installation shows the app without a private identity', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toContainText('JARVIS');
  await expect(page.locator('body')).not.toContainText('undefined');
  const state = await page.request.get('/api/state');
  expect(state.ok()).toBeTruthy();
  const data = await state.json();
  expect(data.records).toEqual([]);
});

test('isolated store saves a record and returns a durable replay receipt', async ({ page }) => {
  const state = await (await page.request.get('/api/state')).json();
  const record = { id: crypto.randomUUID(), kind: 'task', title: 'Public release verification', body: 'Synthetic data only', status: 'open', priority: 'normal', dueDate: '', birthday: '', tags: [], projectId: '', personId: '', sourceUrl: '', deleted: false };
  const change = { operationId: crypto.randomUUID(), serverId: state.serverId, record, baseRev: 0 };
  const options = { data: change, headers: { 'X-Second-Brain': '1' } };
  const first = await page.request.post('/api/mutations', options);
  expect(first.ok()).toBeTruthy();
  const receipt = await first.json();
  const replay = await page.request.post('/api/mutations', options);
  expect(await replay.json()).toEqual(receipt);
  await page.goto('/#/tasks');
  await expect(page.locator('body')).toContainText(record.title);
  await page.reload();
  await expect(page.locator('body')).toContainText(record.title);
  await page.screenshot({ path: 'test-results/public-tasks-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toContainText(record.title);
  await page.screenshot({ path: 'test-results/public-tasks-mobile.png', fullPage: true });
});

test('optional world is explicitly unavailable in this source release', async ({ page }) => {
  await page.goto('/#/agent-town');
  await expect(page.getByText('The separate Agent Town world bundle is not included', { exact: false })).toBeVisible();
  await page.goto('/#/settings/assistant');
  await expect(page.getByRole('heading', { name: 'Voice & AI', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/public-voice-settings.png', fullPage: true });
});

