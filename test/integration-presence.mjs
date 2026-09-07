import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({ entryPoints: ['test/hints-worker.ts'], bundle: true, format: 'esm', write: false, external: ['cloudflare:workers'], target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text,
  compatibilityDate: '2026-09-02', durableObjects: { RACE_ROOMS: { className: 'RaceRoom', useSQLite: true } },
  outboundService: () => { throw Error('No external documents in this test'); },
}));
async function api(path, body, status = 200) {
  const response = await mf.dispatchFetch('https://game' + path, { method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
const action = (s, action, extra = {}, status = 200) => api('/rooms/' + s.code + '/action',
  { action, playerId: s.playerId, playerToken: s.playerToken, ...extra }, status);
const view = s => api('/rooms/' + s.code + '?playerId=' + s.playerId + '&token=' + s.playerToken);

try {
  const ns = await mf.getDurableObjectNamespace('RACE_ROOMS');
  const made = await api('/rooms', { nickname: '접속호스트', mode: 'rounds', roundCount: 3 });
  const host = made.session;
  const guest = (await api('/rooms/' + host.code + '/join', { nickname: '접속게스트' })).session;
  const stub = ns.get(ns.idFromName(host.code));
  const presence = async input => (await stub.fetch('https://room/__test/presence',
    { method: 'POST', body: JSON.stringify(input) })).json();
  async function verifyPresence(phase) {
    // An 8-second heartbeat gap used to remove this player despite active HTTP traffic.
    let players = await presence({ id: guest.playerId, age: 15000, disconnected: true, alarm: true });
    assert.ok(players.some(p => p.id === guest.playerId), phase + ': temporary gap retained');
    await presence({ id: guest.playerId, age: 119000, disconnected: true });
    await view(guest);
    players = await presence({ alarm: true });
    assert.ok(players.find(p => p.id === guest.playerId).lastSeenAt > Date.now() - 5000, phase + ': authenticated poll renewed');
    await presence({ id: guest.playerId, age: 119000 });
    await api('/rooms/' + guest.code + '?playerId=' + guest.playerId + '&token=wrong');
    players = await presence({});
    assert.ok(players.find(p => p.id === guest.playerId).lastSeenAt < Date.now() - 110000, phase + ': invalid token cannot renew');
    await view(guest);
  }
  await verifyPresence('lobby');
  await presence({ id: guest.playerId, age: 119000 });
  await action(guest, 'ready');
  assert.ok((await presence({})).find(p => p.id === guest.playerId).lastSeenAt > Date.now() - 5000, 'action renews presence');
  for (let round = 1; round <= 3; round++) {
    const started = (await action(host, 'start', { hostToken: host.hostToken })).room;
    await verifyPresence('racing ' + round);
    await action(host, 'progress', { nextTitle: started.goalTitle });
    const watching = (await view(host)).room;
    const me = watching.players.find(p => p.id === host.playerId);
    assert.equal(me.roundResults.length, round - 1);
    assert.deepEqual(me.path, [started.startTitle, started.goalTitle], 'current round visible before scoring');
    assert.equal((await view(guest)).room.players.find(p => p.id === host.playerId).path, undefined, 'active racer cannot inspect finisher route');
    await verifyPresence('spectating ' + round);
    await action(guest, 'forfeit');
    const result = (await view(host)).room;
    assert.equal(result.players.find(p => p.id === host.playerId).roundResults.length, round);
    await verifyPresence('results ' + round);
    if (round < 3) {
      await action(host, 'next-round', { hostToken: host.hostToken });
      await verifyPresence('round break ' + round);
      await action(guest, 'ready');
    }
  }
  // Real absence retains finished records but removes the player from the next lobby.
  await presence({ id: guest.playerId, age: 121000, alarm: true });
  assert.equal((await view(host)).room.players.find(p => p.id === guest.playerId).departed, true);
  assert.equal((await action(host, 'rematch', { hostToken: host.hostToken })).room.players.length, 1);
  await action(host, 'leave');
  const solo = (await api('/rooms', { nickname: '혼자검증', mode: 'random' })).session;
  const soloStub = ns.get(ns.idFromName(solo.code));
  await soloStub.fetch('https://room/__test/presence', { method: 'POST', body: JSON.stringify({ id: solo.playerId, age: 15000, alarm: true }) });
  assert.equal((await view(solo)).room.players.length, 1, 'solo room survives short gap');
  await action(solo, 'leave');
  await api('/rooms/' + solo.code, undefined, 404);
  console.log('PASS: presence in lobby/racing/spectating/3 round results; HTTP auth; privacy; expiry; explicit leave');
} finally { await mf.dispose(); }
