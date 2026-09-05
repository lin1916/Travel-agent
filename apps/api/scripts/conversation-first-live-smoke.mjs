#!/usr/bin/env node

const apiBase = (process.env.TRAVEL_SMOKE_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const modelConfigured = Boolean(process.env.TRAVEL_LLM_API_KEY?.trim());
const amapJsConfigured = Boolean(process.env.AMAP_JS_KEY?.trim());
const amapWebConfigured = Boolean(process.env.AMAP_WEB_SERVICE_KEY?.trim());

console.log(`model=${modelConfigured ? 'configured' : 'missing'}`);
console.log(`amap_js=${amapJsConfigured ? 'configured' : 'missing'}`);

if (!modelConfigured || !amapJsConfigured || !amapWebConfigured) {
  console.log(`amap_web_service=${amapWebConfigured ? 'not_run' : 'missing'}`);
  console.log('conversation=not_run');
  console.log('turns_completed=0');
  console.log('trip_created=false');
  console.log('proposal_created=false');
  console.log('latency_ms=0');
  process.exitCode = 2;
} else {
  const startedAt = Date.now();
  let turnsCompleted = 0;
  let tripCreated = false;
  let proposalCreated = false;
  let conversationStatus = 'failed';
  let amapStatus = 'failed';

  try {
    const amapUrl = new URL('/v3/place/text', 'https://restapi.amap.com');
    amapUrl.search = new URLSearchParams({ keywords: '西湖', offset: '1', key: process.env.AMAP_WEB_SERVICE_KEY, output: 'JSON' }).toString();
    const amapResponse = await fetch(amapUrl);
    const amapBody = await amapResponse.json().catch(() => undefined);
    if (amapResponse.ok && amapBody?.status === '1') amapStatus = 'success';
  } catch {
    amapStatus = 'failed';
  }
  console.log(`amap_web_service=${amapStatus}`);

  try {
    const created = await fetch(`${apiBase}/v1/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const setCookie = created.headers.get('set-cookie');
    const conversation = await created.json().catch(() => undefined);
    if (!created.ok || typeof conversation?.id !== 'string' || !setCookie) throw new Error('conversation_create_failed');
    const cookie = setCookie.split(';', 1)[0];

    const messages = [
      ['018f47f2-3a8a-7c71-9d2d-f114dfe66a71', '我想 10 月 1 日到 4 日去杭州'],
      ['018f47f2-3a8a-7c71-9d2d-f114dfe66a72', '两个人，预算 5000 元，喜欢人文景点和本地餐馆'],
    ];
    for (const [clientMessageId, content] of messages) {
      const response = await fetch(`${apiBase}/v1/conversations/${encodeURIComponent(conversation.id)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ content, clientMessageId }),
      });
      const body = await response.json().catch(() => undefined);
      if (!response.ok) throw new Error('conversation_turn_failed');
      if (body?.messages?.some(message => message.role === 'assistant')) turnsCompleted += 1;
      if (typeof body?.tripId === 'string') tripCreated = true;
    }
    const current = await fetch(`${apiBase}/v1/conversations/${encodeURIComponent(conversation.id)}/plan-proposals/current`, { headers: { cookie } });
    const proposalBody = await current.json().catch(() => undefined);
    proposalCreated = typeof proposalBody?.id === 'string' || typeof proposalBody?.proposal?.id === 'string';
    conversationStatus = 'created';
  } catch {
    conversationStatus = 'failed';
  }

  console.log(`conversation=${conversationStatus}`);
  console.log(`turns_completed=${turnsCompleted}`);
  console.log(`trip_created=${tripCreated}`);
  console.log(`proposal_created=${proposalCreated}`);
  console.log(`latency_ms=${Math.max(0, Date.now() - startedAt)}`);
  if (conversationStatus !== 'created') process.exitCode = 1;
}
