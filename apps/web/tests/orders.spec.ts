import { test, expect } from '@playwright/test';
import { installConversationFixture } from './conversation-fixture';

test('planning workspace does not expose booking or payment actions', async ({ page }) => {
  const fixture = await installConversationFixture(page);
  await page.goto('/');
  await expect(page.getByTestId('delete-session')).toBeVisible();
  await expect(page.getByRole('button', { name: /预订|下单|支付|退款|证件/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /预订|下单|支付|退款|证件/ })).toHaveCount(0);
  expect(fixture.unhandled).toEqual([]);
});
