import assert from 'node:assert/strict';
const base = process.env.NAMU_RACE_TEST_URL || 'http://127.0.0.1:8787';
const users = [];
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  assert.ok(response.ok, data.error || String(response.status));
  return data;
}
const action = (s, action, extra = {}) => api('/rooms/' + s.code + '/action',
  { action, playerId: s.playerId, playerToken: s.playerToken, ...extra });
const view = s => api('/rooms/' + s.code + '?playerId=' + s.playerId + '&token=' + s.playerToken);
try {
  assert.equal((await api('/health')).presenceGraceMs, 120000);
  const h = (await api('/rooms', { nickname: '접속점검EXE', mode: 'rounds', roundCount: 2 })).session;
  users.push(h);
  const g = (await api('/rooms/' + h.code + '/join', { nickname: '접속점검웹' })).session;
  users.push(g);
  // Same scenario as the original failure: no WebSocket, but authenticated HTTP remains active.
  for (let i = 0; i < 6; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    assert.equal((await view(h)).room.players.length, 2);
    assert.equal((await view(g)).room.players.length, 2);
  }
  for (let round = 1; round <= 2; round++) {
    await action(g, 'ready');
    const start = (await action(h, 'start', { hostToken: h.hostToken })).room;
    const watching = (await action(h, 'progress', { nextTitle: start.goalTitle })).room;
    const me = watching.players.find(p => p.id === h.playerId);
    assert.equal(me.roundResults.length, round - 1);
    assert.deepEqual(me.path, [start.startTitle, start.goalTitle]);
    const hidden = (await view(g)).room.players.find(p => p.id === h.playerId);
    assert.equal(hidden.path, undefined);
    await action(g, 'progress', { nextTitle: '과학' });
    assert.equal((await view(h)).room.players.find(p => p.id === g.playerId).currentTitle, '과학');
    const result = (await action(g, 'forfeit')).room;
    assert.equal(result.players.find(p => p.id === h.playerId).roundResults.length, round);
    if (round < 2) await action(h, 'next-round', { hostToken: h.hostToken });
  }
  await action(g, 'leave');
  const retained = (await view(h)).room.players.find(p => p.id === g.playerId);
  assert.equal(retained.departed, true);
  assert.equal(retained.roundResults.length, 2);
  assert.equal((await action(h, 'rematch', { hostToken: h.hostToken })).room.players.length, 1);
  console.log('PASS: public HTTP-only presence, 2 rounds, immediate current path, privacy and retained results');
} finally {
  for (const user of users.reverse()) await action(user, 'leave').catch(() => {});
}
