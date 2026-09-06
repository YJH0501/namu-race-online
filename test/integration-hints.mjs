import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { getHintCard, HINT_GOAL_TITLES } from '../shared/hint-catalog.mjs';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({ entryPoints: ['test/hints-worker.ts'], bundle: true, format: 'esm', write: false, external: ['cloudflare:workers'], target: 'es2022' });
let upstreamCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-09-02',
  durableObjects: { RACE_ROOMS: { className: 'RaceRoom', useSQLite: true } },
  outboundService: () => { upstreamCalls++; throw Error('Prepared hints must never request an external document'); },
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
  const card = getHintCard(started.goalTitle);
  assert.ok(card);
  assert.equal(first.hint.format, 'card-v1');
  assert.equal(first.hint.summary, card.summary);
  assert.deepEqual(first.hint.relatedTitles, [], 'Related concepts must not leak before stage two');
  assert.equal(first.hint.card, undefined, 'Private card snapshot never leaves the server');
  assert.equal((await view(guest)).room.hint.level, 1);
  assert.equal(first.hint.source, card.source);
  assert.equal(first.hint.sourceLicense, card.sourceLicense);
  assert.equal(upstreamCalls, 0);
  await action(host, 'hint-vote', { ...ballot, hintLevel: 2 }, 409);
  const ns = await mf.getDurableObjectNamespace('RACE_ROOMS');
  const stub = ns.get(ns.idFromName(host.code));
  await stub.fetch('https://room/__test/advance-hint');
  await action(host, 'hint-vote', { ...ballot, hintLevel: 2 });
  await action(guest, 'hint-vote', { ...ballot, hintLevel: 2 });
  const second = await waitFor(guest, (r) => r.hint.level === 2);
  assert.equal(second.hint.summary, card.summary);
  assert.deepEqual(second.hint.relatedTitles, card.relatedTitles);
  assert.equal(upstreamCalls, 0, 'Both stages work with all external requests forbidden');
  assert.equal(second.hint.source, first.hint.source);
  assert.equal(second.hint.sourceUrl, first.hint.sourceUrl);

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
  assert.equal(simple.room.hintAvailable, false, 'Unsupported custom goal warns before start');
  const h = simple.session;
  const g = (await api(`/rooms/${h.code}/join`, { nickname: '친구' })).session;
  await action(g, 'ready'); const noCard = (await action(h, 'start', { hostToken: h.hostToken })).room;
  assert.equal(noCard.hint.available, false);
  assert.equal(noCard.hint.canRequest, false);
  await action(h, 'hint-vote', { hintLevel: 1, startedAt: noCard.startedAt }, 409);
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
  // Exercise every supported goal through the real API, not only pure helpers.
  for (const title of HINT_GOAL_TITLES) {
    const made = await api('/rooms', { nickname: '카드검증', mode: 'custom', startTitle: '테스트 출발', goalTitle: title });
    const user = made.session;
    const begun = (await action(user, 'start', { hostToken: user.hostToken })).room;
    assert.equal(begun.hint.summary, '');
    assert.deepEqual(begun.hint.relatedTitles, []);
    const ballot = { hintLevel: 1, startedAt: begun.startedAt };
    const one = (await action(user, 'hint-vote', ballot)).room.hint;
    assert.equal(one.level, 1, title + ': immediate stage one');
    assert.equal(one.summary, getHintCard(title).summary);
    await ns.get(ns.idFromName(user.code)).fetch('https://room/__test/advance-hint');
    const two = (await action(user, 'hint-vote', { ...ballot, hintLevel: 2 })).room.hint;
    assert.deepEqual(two.relatedTitles, getHintCard(title).relatedTitles);
    await action(user, 'leave');
  }
  // Full ten-round series: supported goals, broad starts, no repeated goal.
  const series = await api('/rooms', { nickname: '라운드검증', mode: 'rounds', roundCount: 10 });
  const used = new Set();
  for (let round = 1; round <= 10; round++) {
    const race = (await action(series.session, 'start', { hostToken: series.session.hostToken })).room;
    assert.equal(race.round, round);
    assert.ok(getHintCard(race.goalTitle));
    assert.ok(!used.has(race.goalTitle));
    used.add(race.goalTitle);
    assert.notEqual(race.startTitle, race.goalTitle);
    await action(series.session, 'forfeit');
    if (round < 10) {
      const waiting = (await action(series.session, 'next-round', { hostToken: series.session.hostToken })).room;
      assert.equal(waiting.hint, null); assert.equal(waiting.goalTitle, null);
    }
  }
  await action(series.session, 'leave');
  assert.equal(upstreamCalls, 0);
  console.log(JSON.stringify({ ok: true, preparedCards: HINT_GOAL_TITLES.length, upstreamCalls, tenDistinctRounds: true, majority: true, twoStages: true, noEarlyLeak: true, departedResultsRetained: true, rematchCleanup: true }));
} finally { await mf.dispose(); }
