import { test, expect } from '@playwright/test';
import { installConversationFixture } from './conversation-fixture';

test('Conversation-first planning supports map search, candidates, chat, proposal acceptance and recovery', async ({ page }) => {
  const fixture = await installConversationFixture(page);
  await page.goto('/');

  await expect(page.getByText('精确编辑行程范围')).toHaveCount(0);
  await expect(page.locator('#destination')).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '地图' }).click();
  await expect(page.getByPlaceholder('搜索景点、餐厅或酒店')).toBeVisible();
  const placeSearch = page.getByLabel('搜索景点、餐厅或酒店');
  await placeSearch.fill('西湖');
  await placeSearch.press('Enter');
  await expect(page.getByLabel('地点搜索结果').getByText('灵隐寺')).toBeVisible();
  await page.getByRole('button', { name: '加入候选：西湖' }).click();
  await expect(page.getByRole('heading', { name: '候选地点' })).toBeVisible();
  await expect(page.getByText('1 个')).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '聊天' }).click();
  const composer = page.getByLabel('你的想法');
  await composer.fill('我想 10 月 1 日到 4 日去杭州');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('我先记录杭州和日期，请再告诉我出行人数。')).toBeVisible();
  await expect(page.locator('.agent-progress__reasoning')).toHaveText('已整理地点、预算和游玩节奏');

  await page.getByRole('button', { name: '杭州', exact: true }).click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('我想修改「杭州」：');

  await composer.fill('两个人，预算 5000 元，喜欢人文景点和本地餐馆');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('信息完整，我已整理好一份待确认的杭州行程提案。')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '行程' }).click();
  await expect(page.getByRole('heading', { name: '行程提案' })).toBeVisible();
  await expect(page.getByRole('button', { name: '接受行程' })).toBeVisible();
  expect(fixture.messageCalls).toHaveLength(2);
  expect(new Set(fixture.messageCalls.map(message => message.clientMessageId)).size).toBe(2);

  await page.getByRole('button', { name: '接受行程' }).click();
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '行程' }).click();
  await expect(page.getByRole('heading', { name: '行程时间线' }).first()).toBeVisible();
  await expect(page.getByText('已接受杭州行程提案')).toBeVisible();
  await expect(page.locator('.formal-plan .budget-panel')).toBeVisible();

  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '聊天' }).click();
  await composer.fill('第二天轻松一点');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('好的，我会把第二天调整得更轻松，并生成新的待确认提案。')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '行程' }).click();
  await expect(page.getByRole('heading', { name: '行程提案' })).toBeVisible();
  expect(fixture.messageCalls).toHaveLength(3);

  await page.reload();
  await expect(page.getByText('第二天轻松一点')).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '行程' }).click();
  await expect(page.getByRole('heading', { name: '行程时间线' }).first()).toBeVisible();
  await page.getByRole('button', { name: '撤销上次调整' }).click();
  await expect(page.getByTestId('plan-change-summary')).toHaveText('已撤销上次调整');
  await expect.poll(() => fixture.sseLastEventIds.some(value => value === 'event-7')).toBe(true);
  if ((page.viewportSize()?.width ?? 1440) <= 760) await page.getByRole('button', { name: '聊天' }).click();
  await page.getByTestId('delete-session').click();
  await expect(page.getByText('Voyager Agent')).toBeVisible();
  expect(fixture.state().deleted).toBe(true);
  expect(fixture.unhandled).toEqual([]);
});

test('failed deletion keeps the current conversation and can be retried', async ({ page }) => {
  const fixture = await installConversationFixture(page);
  await page.goto('/');
  await expect(page.getByTestId('delete-session')).toBeVisible();
  const reference = await page.evaluate(() => sessionStorage.getItem('travel-agent.conversation-reference'));
  await page.route('**/api/v1/conversations/conversation-1', route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ publicMessage: '清空暂时失败' }) })
    : route.fallback());
  await page.getByTestId('delete-session').click();
  await expect(page.getByRole('alert')).toHaveText('清空暂时失败');
  expect(await page.evaluate(() => sessionStorage.getItem('travel-agent.conversation-reference'))).toBe(reference);
  expect(fixture.state().deleted).toBe(false);
});
