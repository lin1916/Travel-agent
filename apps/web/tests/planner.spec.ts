import { test, expect } from '@playwright/test';

test.describe('anonymous planning workspace', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('creates a domestic trip and shows the planning workspace with offers', async ({ page }) => {
    await page.getByLabel('目的地').fill('杭州');
    await page.getByLabel('出发日期').fill('2026-09-01');
    await page.getByLabel('返程日期').fill('2026-09-03');
    await page.getByLabel('出行人数').fill('2');
    await page.getByRole('button', { name: '开始规划' }).click();

    await expect(page.getByRole('heading', { name: '杭州行程工作台' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Agent 活动' })).toBeVisible();
    await expect(page.getByTestId('offer-card').first()).toBeVisible();
    const viewport = page.viewportSize();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport?.width ?? 0);
  });
});
