import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({ entryPoints: ['test/hints-worker.ts'], bundle: true, format: 'esm', write: false, external: ['cloudflare:workers'], target: 'es2022' });
let upstreamCalls = 0;
const fixture = '<meta property="og:title" content="인공지능"><meta property="og:description" content="인공지능의 설명입니다."><a href="/w/분류:컴퓨터%20과학">컴퓨터 과학</a><table><div class="wiki-paragraph">이 표 안의 내용은 힌트에 들어가면 안 됩니다.</div></table><div class="wiki-paragraph">인공지능은 인간의 학습 능력과 추론 능력을 컴퓨터로 구현하는 기술이다.<sup class="wiki-footnote">[1]</sup> 두 번째 문장.</div>';
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-09-02',
  durableObjects: { RACE_ROOMS: { className: 'RaceRoom', useSQLite: true } },
  outboundService: async (request) => {
    assert.equal(new URL(request.url).origin, 'https://namu-race.yangkun050178.chatgpt.site');
    assert.equal(new URL(request.url).pathname, '/api/article');
    upstreamCalls++;
    return new Response(fixture, { headers: { 'content-type': 'text/html' } });
  },
}));

async function api(path, body, status = 200) {
  const response = await mf.dispatchFetch(`https://game${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const action = (s, type, extra = {}, status = 200) => api(`/rooms/${s.code}/action`, { action: type, playerId: s.playerId, playerToken: s.playerToken, ...extra }, status);
const view = (s) => api(`/rooms/${s.code}?playerId=${s.playerId}&token=${s.playerToken}`);
async function waitFor(s, predicate) {
  for (let i = 0; i < 100; i++) {
    const { room } = await view(s);
    if (predicate(room)) return room;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw Error('Room state timed out');
}

try {
  const created = await api('/rooms', { nickname: '윈도우', mode: 'rounds', roundCount: 2 });
  const host = created.session;
  const guest = (await api(`/rooms/${host.code}/join`, { nickname: '맥웹' })).session;
  assert.equal(created.room.hint, null);
  assert.equal(upstreamCalls, 0, 'No document download in the lobby');
  await action(guest, 'ready');
  const { room: started } = await action(host, 'start', { hostToken: host.hostToken });
  const ballot = { hintLevel: 1, startedAt: started.startedAt };
  await action(host, 'hint-vote', { ...ballot, playerToken: 'invalid' }, 401);
  await action(host, 'hint-vote', { ...ballot, startedAt: 0 }, 409);
  await action(host, 'hint-vote', ballot);
  const duplicate = await action(host, 'hint-vote', ballot);
  assert.equal(duplicate.room.hint.votes, 1);
  assert.equal(duplicate.room.hint.level, 0);
  assert.equal(upstreamCalls, 0);
  await action(guest, 'hint-vote', ballot);
  const first = await waitFor(host, (r) => r.hint.level === 1);
  assert.deepEqual(first.hint.categories, ['컴퓨터 과학']);
  assert.equal(first.hint.summary, '', 'Summary must not leak before stage two');
  assert.equal((await view(guest)).room.hint.level, 1);
  assert.equal(upstreamCalls, 1);
  await action(host, 'hint-vote', { ...ballot, hintLevel: 2 }, 409);
  const ns = await mf.getDurableObjectNamespace('RACE_ROOMS');
  const stub = ns.get(ns.idFromName(host.code));
  await stub.fetch('https://room/__test/advance-hint');
  await action(host, 'hint-vote', { ...ballot, hintLevel: 2 });
  await action(guest, 'hint-vote', { ...ballot, hintLevel: 2 });
  const second = await waitFor(guest, (r) => r.hint.level === 2);
  assert.match(second.hint.summary, /학습 능력/);
  assert.doesNotMatch(second.hint.summary, /표 안|두 번째|\[1\]/);
  assert.equal(upstreamCalls, 1, 'Second hint reuses the bounded cached excerpt');

  // A finisher leaves while the other is still racing: preserve their score baseline and path.
  await action(guest, 'progress', { nextTitle: started.goalTitle });
  await action(guest, 'hint-vote', { ...ballot, hintLevel: 3 }, 409);
  await action(guest, 'leave');
  const racing = (await view(host)).room;
  assert.equal(racing.players.length, 2);
  assert.equal(racing.players.find((p) => p.id === guest.playerId).departed, true);
  assert.equal(racing.players.find((p) => p.id === guest.playerId).path, undefined, 'Active racers still cannot inspect paths');
  await action(host, 'progress', { nextTitle: '중간 문서' });
  const { room: result } = await action(host, 'progress', { nextTitle: started.goalTitle });
  assert.equal(result.status, 'round_result');
  const former = result.players.find((p) => p.id === guest.playerId);
  assert.deepEqual(former.path, [started.startTitle, started.goalTitle]);
  assert.equal(former.roundResults[0].score, 1000);
  assert.equal(former.roundResults[0].hintLevel, 2);
  assert.equal(result.players.find((p) => p.id === host.playerId).roundResults[0].clickScore, 300);
  const next = await action(host, 'next-round', { hostToken: host.hostToken });
  assert.equal(next.room.players.length, 1);
  assert.equal(next.room.hint, null);
  await action(host, 'start', { hostToken: host.hostToken });
  const current = (await view(host)).room;
  await action(host, 'progress', { nextTitle: current.goalTitle });
  await action(host, 'rematch', { hostToken: host.hostToken });
  await action(host, 'leave');

  // Completed-room disconnection retains the final record, transfers host, and clears on rematch.
  const simple = await api('/rooms', { nickname: '방장', mode: 'custom', startTitle: '출발', goalTitle: '목표' });
  const h = simple.session;
  const g = (await api(`/rooms/${h.code}/join`, { nickname: '친구' })).session;
  await action(g, 'ready'); await action(h, 'start', { hostToken: h.hostToken });
  await action(h, 'progress', { nextTitle: '목표' }); await action(g, 'forfeit');
  const s = ns.get(ns.idFromName(h.code));
  await s.fetch('https://room/__test/disconnect', { method: 'POST', body: h.playerId });
  const disconnected = (await view(g)).room;
  assert.equal(disconnected.status, 'finished');
  assert.equal(disconnected.players.length, 2);
  assert.equal(disconnected.hostPlayerId, g.playerId);
  assert.deepEqual(disconnected.players.find((p) => p.id === h.playerId).path, ['출발', '목표']);
  assert.equal((await action(g, 'rematch', { hostToken: disconnected.hostToken })).room.players.length, 1);
  await action(g, 'leave');
  console.log(JSON.stringify({ ok: true, majority: true, twoStages: true, noEarlyLeak: true, cacheReused: true, departedResultsRetained: true, scoreBaselineRetained: true, rematchCleanup: true }));
} finally { await mf.dispose(); }
