import { test, expect } from '@playwright/test';

test.describe('anonymous planning workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('creates a domestic trip and shows the planning workspace with offers', async ({ page }) => {
    await page.route('**/api/v1/trips/*/itinerary', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [], warnings: [{ code: 'transfer_tight', message: '相邻安排的换乘时间较紧。', severity: 'warning' }] }),
    }));
    await page.getByLabel('目的地').fill('杭州');
    await page.getByLabel('出发日期').fill('2026-09-01');
    await page.getByLabel('返程日期').fill('2026-09-03');
    await page.getByLabel('出行人数').fill('2');
    const tripRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/v1/trips'));
    await page.getByRole('button', { name: '开始规划' }).click();
    const tripActor = (await tripRequest).headers()['x-actor-id'];
    const agentRequest = await page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/v1/agent/runs'));

    await expect(page.getByRole('heading', { name: '杭州行程工作台' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Agent 活动' })).toBeVisible();
    await expect(page.getByTestId('offer-card').first()).toBeVisible();
    await expect(page.getByText('提醒：相邻安排的换乘时间较紧。')).toBeVisible();
    await expect(page.getByText('供应商模式：Mock/Sandbox')).toBeVisible();
    expect(agentRequest.headers()['x-actor-id']).toBe(tripActor);
    const viewport = page.viewportSize();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport?.width ?? 0);
  });
});
