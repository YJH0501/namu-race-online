import assert from 'node:assert/strict';
const origin = process.env.NAMU_RACE_TEST_URL;
const goalTitle = process.env.NAMU_RACE_HINT_TITLE || '인공지능';
if (!origin) throw Error('Set NAMU_RACE_TEST_URL explicitly');
let session;
async function api(path, body) {
  const r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const data = await r.json(); assert.ok(r.ok, JSON.stringify(data)); return data;
}
try {
  const made = await api('/rooms', { nickname: '힌트검증', mode: 'custom', startTitle: '축구', goalTitle });
  session = made.session;
  const body = { playerId: session.playerId, playerToken: session.playerToken };
  const { room } = await api(`/rooms/${session.code}/action`, { action: 'start', hostToken: session.hostToken });
  await api(`/rooms/${session.code}/action`, { ...body, action: 'hint-vote', hintLevel: 1, startedAt: room.startedAt });
  let hint;
  let preparedToken;
  for (let i = 0; i < 32; i++) {
    const result = await api(`/rooms/${session.code}?playerId=${session.playerId}&token=${session.playerToken}`);
    hint = result.room.hint;
    if (hint.prepareToken && preparedToken !== hint.prepareToken) {
      preparedToken = hint.prepareToken;
      const r = await fetch('https://namu-race.yangkun050178.chatgpt.site/api/hints',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:session.code,token:preparedToken}),signal:AbortSignal.timeout(22000)});
      assert.ok(r.ok || r.status===409,await r.text());
      // Cache hits can be published by the room alarm before the client's
      // redundant preparation/notification finishes. Read the authoritative state.
      const notify=await fetch(origin+`/rooms/${session.code}/action`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,action:'hint-ready',requestId:preparedToken,startedAt:room.startedAt})});
      assert.ok(notify.ok || notify.status===409,await notify.text());
    }
    if (hint.level === 1 || hint.status === 'unavailable') break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(hint.level, 1, JSON.stringify(hint));
  assert.ok(['card-v1','document-v1'].includes(hint.format));
  assert.equal(hint.available, true);
  assert.ok(hint.format==='card-v1' ? hint.summary.length >= 15 : hint.categories.length || hint.summary);
  assert.deepEqual(hint.relatedTitles, []);
  assert.equal(hint.card, undefined);
  assert.equal(hint.source, hint.format==='card-v1'?'wikipedia':'namuwiki');
  if (process.env.NAMU_RACE_EXPECT_HINT_SOURCE) assert.equal(hint.source, process.env.NAMU_RACE_EXPECT_HINT_SOURCE);
  const stageOneSource = hint.sourceUrl;
  if (process.env.NAMU_RACE_FULL_HINT_SMOKE === '1') {
    console.log(JSON.stringify({ stageOne: true, goalTitle, source: hint.source }));
    // The test machine's wall clock can differ from the server. Use the server's
    // eligibility flag rather than subtracting timestamps from two clocks.
    for (let i = 0; i < 90 && !hint.canRequest; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      hint = (await api(`/rooms/${session.code}?playerId=${session.playerId}&token=${session.playerToken}`)).room.hint;
    }
    assert.equal(hint.canRequest, true, 'Server did not enable the second ballot within 90 seconds');
    await api(`/rooms/${session.code}/action`, { ...body, action: 'hint-vote', hintLevel: 2, startedAt: room.startedAt });
    for (let i = 0; i < 20; i++) {
      hint = (await api(`/rooms/${session.code}?playerId=${session.playerId}&token=${session.playerToken}`)).room.hint;
      if (hint.level === 2 || hint.status === 'unavailable') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(hint.level, 2);
    assert.equal(hint.sourceUrl, stageOneSource);
    assert.ok(hint.summary.length >= 15, `${goalTitle}: no usable description`);
    if(hint.format==='card-v1')assert.ok(hint.relatedTitles.length >= 2);
    console.log(JSON.stringify({ liveStageTwo: true, description: hint.summary, relatedTitles: hint.relatedTitles }));
  }
  console.log(JSON.stringify({ ok: true, goalTitle, source: hint.source, sourceUrl: hint.sourceUrl, relatedHiddenBeforeStageTwo: true }));
} finally {
  if (session) await api(`/rooms/${session.code}/action`, { action: 'leave', playerId: session.playerId, playerToken: session.playerToken });
}
