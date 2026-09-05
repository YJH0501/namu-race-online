import assert from 'node:assert/strict';
const origin = process.env.NAMU_RACE_TEST_URL;
if (!origin) throw Error('Set NAMU_RACE_TEST_URL explicitly');
let session;
async function api(path, body) {
  const r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
try {
  const made = await api('/rooms', { nickname: '힌트검증', mode: 'custom', startTitle: '축구', goalTitle: '인공지능' });
  session = made.session;
  const body = { playerId: session.playerId, playerToken: session.playerToken };
  const { room } = await api(`/rooms/${session.code}/action`, { action: 'start', hostToken: session.hostToken });
  await api(`/rooms/${session.code}/action`, { ...body, action: 'hint-vote', hintLevel: 1, startedAt: room.startedAt });
  let hint;
  for (let i = 0; i < 20; i++) {
    const result = await api(`/rooms/${session.code}?playerId=${session.playerId}&token=${session.playerToken}`);
    hint = result.room.hint;
    if (hint.level === 1 || hint.status === 'unavailable') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(hint.level, 1, JSON.stringify(hint));
  assert.ok(hint.categories.length);
  assert.equal(hint.summary, '');
  if (process.env.NAMU_RACE_FULL_HINT_SMOKE === '1') {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, hint.nextAvailableAt - Date.now()) + 100));
    await api(`/rooms/${session.code}/action`, { ...body, action: 'hint-vote', hintLevel: 2, startedAt: room.startedAt });
    for (let i = 0; i < 20; i++) {
      hint = (await api(`/rooms/${session.code}?playerId=${session.playerId}&token=${session.playerToken}`)).room.hint;
      if (hint.level === 2 || hint.status === 'unavailable') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(hint.level, 2);
    assert.match(hint.summary, /학습능력/);
    console.log(JSON.stringify({ liveStageTwo: true, description: hint.summary }));
  }
  console.log(JSON.stringify({ ok: true, liveSource: true, categories: hint.categories, hiddenSummary: true }));
} finally {
  if (session) await api(`/rooms/${session.code}/action`, { action: 'leave', playerId: session.playerId, playerToken: session.playerToken });
}
