import { test, expect } from '@playwright/test';
test('planner renders an action center label when orders are available', async ({ page }) => { await page.goto('/'); await expect(page.locator('body')).toContainText('开始规划'); });
