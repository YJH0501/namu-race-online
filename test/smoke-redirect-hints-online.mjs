import assert from 'node:assert/strict';
const game = process.env.NAMU_RACE_TEST_URL || 'http://127.0.0.1:8787';
const site = process.env.NAMU_RACE_HINT_SITE || 'http://localhost:3000';
async function api(path, body) {
  const r = await fetch(game + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const data = await r.json(); assert.ok(r.ok, data.error || String(r.status)); return data;
}
const action = (s, action, more = {}) => api('/rooms/' + s.code + '/action',
  { action, playerId: s.playerId, playerToken: s.playerToken, ...more });
const view = s => api('/rooms/' + s.code + '?playerId=' + s.playerId + '&token=' + s.playerToken);
for (const [goal, expected] of [['JIT 컴파일', 'JIT'], ['슈퍼주니어-T', 'SUPER JUNIOR-T']]) {
  const sessions = [];
  try {
    const h = (await api('/rooms', { nickname: '힌트검증EXE', mode: 'custom', startTitle: '고양이', goalTitle: goal })).session;
    sessions.push(h);
    const g = (await api('/rooms/' + h.code + '/join', { nickname: '힌트검증웹' })).session;
    sessions.push(g);
    await action(g, 'ready');
    const start = (await action(h, 'start', { hostToken: h.hostToken })).room;
    const ballot = { hintLevel: 1, startedAt: start.startedAt };
    await action(h, 'hint-vote', ballot);
    assert.equal((await view(h)).room.hint.level, 0);
    const voted = (await action(g, 'hint-vote', ballot)).room;
    const token = voted.hint.prepareToken;
    assert.ok(token);
    const prepare = await fetch(site + '/api/hints', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: h.code, token }), signal: AbortSignal.timeout(22000) });
    const prepared = await prepare.json(); assert.ok(prepare.ok, JSON.stringify(prepared));
    assert.equal(prepared.hint, undefined); assert.equal(prepared.summary, undefined, 'preparing client must not get unreleased text');
    await action(g, 'hint-ready', { startedAt: start.startedAt, requestId: token });
    let room;
    for (let i = 0; i < 12; i++) {
      room = (await view(h)).room;
      if (room.hint.level === 1 || room.hint.status === 'unavailable') break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(room.hint.level, 1, JSON.stringify(room.hint));
    assert.equal(room.goalTitle, goal);
    assert.equal(room.hint.sourceTitle, expected);
    assert.equal((await view(g)).room.hint.sourceTitle, expected);
    assert.ok(room.hint.categories.length || room.hint.summary);
    console.log(JSON.stringify({ goal, sourceTitle: room.hint.sourceTitle, hintLevel: room.hint.level, twoPlayersAgree: true }));
  } finally {
    for (const s of sessions.reverse()) await action(s, 'leave').catch(() => {});
  }
}
