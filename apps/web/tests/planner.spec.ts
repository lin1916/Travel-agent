import { test, expect } from '@playwright/test';
import { installConversationFixture } from './conversation-fixture';

test.describe('Conversation-first entry', () => {
  test('starts with chat and map exploration instead of a Trip form', async ({ page }) => {
    const fixture = await installConversationFixture(page);
    await page.goto('/');
    await expect(page.getByText('Voyager Agent')).toBeVisible();
    await expect(page.getByText('先聊旅行，再决定行程')).toBeVisible();
    await expect(page.getByText('精确编辑行程范围')).toHaveCount(0);
    await expect(page.locator('.planner-form')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
    if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '地图' }).click();
    await expect(page.getByPlaceholder('搜索景点、餐厅或酒店')).toBeVisible();
    expect(fixture.unhandled).toEqual([]);
  });
});
