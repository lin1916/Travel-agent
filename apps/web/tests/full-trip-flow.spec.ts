import { test, expect } from '@playwright/test';

test('full mock workflow renders planning state and survives refresh boundary', async ({ page }) => {
  await page.route('**/api/v1/trips', route => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'trip-demo-001', destination: '杭州' }) }));
  await page.route('**/api/v1/agent/runs', route => route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ id: 'run-demo-001' }) }));
  await page.route('**/api/v1/trips/*/itinerary', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'item-train-001', category: 'train', startsAt: '2026-09-01T08:00:00+08:00', endsAt: '2026-09-01T10:00:00+08:00' }, { id: 'item-stay-001', category: 'stay', startsAt: '2026-09-01T15:00:00+08:00', endsAt: '2026-09-03T12:00:00+08:00' }], warnings: [] }) }));
  await page.goto('/');
  await page.getByLabel('目的地').fill('杭州');
  await page.getByLabel('出发日期').fill('2026-09-01');
  await page.getByLabel('返程日期').fill('2026-09-03');
  await page.getByRole('button', { name: '开始规划' }).click();
  await expect(page.getByRole('heading', { name: '杭州行程工作台' })).toBeVisible();
  await expect(page.getByText('供应商模式：Mock/Sandbox')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '开始规划' })).toBeVisible();
});
