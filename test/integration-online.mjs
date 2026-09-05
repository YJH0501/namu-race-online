import assert from 'node:assert/strict';
import { koreaDateKey } from '../shared/korea-date.mjs';

const baseUrl = process.env.NAMU_RACE_TEST_URL || 'http://127.0.0.1:8787';

async function api(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.ok, true, `${method} ${path}: ${data.error || response.status}`);
  return data;
}

async function apiError(method, path, body, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, expectedStatus, `${method} ${path}`);
  return data;
}

function firstSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket 응답 시간 초과')), 3_000);
    socket.addEventListener('message', (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(event.data));
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('WebSocket 연결 실패'));
    }, { once: true });
  });
}

const health = await api('GET', '/health');
assert.equal(health.ok, true);

const daily = await api('GET', '/daily');
assert.equal(daily.route.dateKey, koreaDateKey(), '오늘의 레이스는 한국 날짜를 사용해야 합니다.');

const created = await api('POST', '/rooms', {
  nickname: '윈도우',
  mode: 'custom',
  startTitle: '축구',
  goalTitle: '인공지능',
});
assert.match(created.session.code, /^[A-Z0-9]{6}$/);
assert.equal(created.room.startTitle, '축구');
assert.equal(created.room.goalTitle, '인공지능');

const code = created.session.code;
const joined = await api('POST', `/rooms/${code}/join`, { nickname: '맥북' });
assert.equal(joined.room.players.length, 2);

const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/rooms/${code}/ws?playerId=${encodeURIComponent(joined.session.playerId)}&token=${encodeURIComponent(joined.session.playerToken)}`;
const socket = new WebSocket(wsUrl);
const initial = await firstSocketMessage(socket);
assert.equal(initial.type, 'room');
assert.equal(initial.room.code, code);

await api('POST', `/rooms/${code}/action`, {
  action: 'ready',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
});
const started = await api('POST', `/rooms/${code}/action`, {
  action: 'start',
  hostToken: created.session.hostToken,
});
assert.equal(started.room.status, 'racing');

await api('POST', `/rooms/${code}/action`, {
  action: 'progress',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
  nextTitle: '과학',
});
const backed = await api('POST', `/rooms/${code}/action`, {
  action: 'back',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
});
const backedPlayer = backed.room.players.find(
  (player) => player.id === joined.session.playerId,
);
assert.equal(backedPlayer.currentTitle, '축구');
assert.equal(backedPlayer.clicks, 2, '뒤로가기도 클릭 수에 포함해야 합니다.');
assert.equal(backedPlayer.canGoBack, false);
await apiError('POST', `/rooms/${code}/action`, {
  action: 'back',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
}, 409);
await api('POST', `/rooms/${code}/action`, {
  action: 'progress',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
  nextTitle: '과학',
});
const hostView = await api(
  'GET',
  `/rooms/${code}?playerId=${encodeURIComponent(created.session.playerId)}&token=${encodeURIComponent(created.session.playerToken)}`,
);
assert.equal(
  hostView.room.players.find((player) => player.id === created.session.playerId).currentTitle,
  '축구',
  '인증된 참가자에게는 자신의 현재 문서를 보여줘야 합니다.',
);
assert.equal(
  hostView.room.players.find((player) => player.id === joined.session.playerId).currentTitle,
  null,
  '레이스 중에는 다른 참가자의 현재 문서를 숨겨야 합니다.',
);
assert.equal(
  'path' in hostView.room.players.find((player) => player.id === joined.session.playerId),
  false,
  '레이스 중에는 다른 참가자의 전체 경로를 보내면 안 됩니다.',
);

await api('POST', `/rooms/${code}/action`, {
  action: 'progress',
  playerId: joined.session.playerId,
  playerToken: joined.session.playerToken,
  nextTitle: '인공지능',
});
const finished = await api('POST', `/rooms/${code}/action`, {
  action: 'forfeit',
  playerId: created.session.playerId,
  playerToken: created.session.playerToken,
});
assert.equal(finished.room.status, 'finished');
assert.equal(finished.room.players.some((player) => player.finishedAt), true);
assert.equal(finished.room.players.some((player) => player.forfeitedAt), true);
assert.deepEqual(
  finished.room.players.find((player) => player.id === joined.session.playerId).path,
  ['축구', '과학', '축구', '과학', '인공지능'],
  '최종 결과에는 참가자의 전체 이동 경로를 포함해야 합니다.',
);

const rematch = await api('POST', `/rooms/${code}/action`, {
  action: 'rematch',
  hostToken: created.session.hostToken,
});
assert.equal(rematch.room.status, 'waiting');
assert.equal(rematch.room.round, 2);
assert.equal(rematch.room.mode, 'custom');
assert.equal(rematch.room.startTitle, '축구');
assert.equal(rematch.room.goalTitle, '인공지능');
assert.equal(rematch.room.players.find((player) => player.id === created.session.playerId).ready, true);
assert.equal(rematch.room.players.find((player) => player.id === joined.session.playerId).ready, false);

const randomCreated = await api('POST', '/rooms', { nickname: '랜덤방장', mode: 'random' });
assert.equal(randomCreated.room.routeHidden, true);
assert.equal(randomCreated.room.startTitle, null);
assert.equal(randomCreated.room.goalTitle, null);
assert.equal(randomCreated.room.players[0].currentTitle, null);
const randomStarted = await api('POST', `/rooms/${randomCreated.session.code}/action`, {
  action: 'start',
  hostToken: randomCreated.session.hostToken,
});
assert.equal(randomStarted.room.status, 'racing');
assert.equal(typeof randomStarted.room.startTitle, 'string');
assert.equal(typeof randomStarted.room.goalTitle, 'string');
assert.notEqual(randomStarted.room.startTitle, randomStarted.room.goalTitle);
await api('POST', `/rooms/${randomCreated.session.code}/action`, {
  action: 'forfeit',
  playerId: randomCreated.session.playerId,
  playerToken: randomCreated.session.playerToken,
});

const roundsCreated = await api('POST', '/rooms', {
  nickname: '라운드방장',
  mode: 'rounds',
  roundCount: 3,
});
assert.equal(roundsCreated.room.mode, 'rounds');
assert.equal(roundsCreated.room.totalRounds, 3);
assert.equal(roundsCreated.room.routeHidden, true);
assert.equal(roundsCreated.room.players[0].currentTitle, null);
const roundsJoined = await api(
  'POST',
  `/rooms/${roundsCreated.session.code}/join`,
  { nickname: '라운드친구' },
);
await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
  action: 'ready',
  playerId: roundsJoined.session.playerId,
  playerToken: roundsJoined.session.playerToken,
});
let roundsRoom = (
  await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
    action: 'start',
    hostToken: roundsCreated.session.hostToken,
  })
).room;
assert.equal(roundsRoom.routeHidden, false);

for (let round = 1; round <= 3; round += 1) {
  if (round > 1) {
    await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
      action: 'ready',
      playerId: roundsJoined.session.playerId,
      playerToken: roundsJoined.session.playerToken,
    });
    roundsRoom = (
      await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
        action: 'start',
        hostToken: roundsCreated.session.hostToken,
      })
    ).room;
  }
  await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
    action: 'progress',
    playerId: roundsCreated.session.playerId,
    playerToken: roundsCreated.session.playerToken,
    nextTitle: roundsRoom.goalTitle,
  });
  roundsRoom = (
    await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
      action: 'forfeit',
      playerId: roundsJoined.session.playerId,
      playerToken: roundsJoined.session.playerToken,
    })
  ).room;
  assert.equal(
    roundsRoom.status,
    round < 3 ? 'round_result' : 'finished',
  );
  const leader = roundsRoom.players.find(
    (player) => player.id === roundsCreated.session.playerId,
  );
  assert.equal(leader.roundResults.length, round);
  assert.equal(leader.score, round * 1000);
  if (round < 3) {
    roundsRoom = (
      await api('POST', `/rooms/${roundsCreated.session.code}/action`, {
        action: 'next-round',
        hostToken: roundsCreated.session.hostToken,
      })
    ).room;
    assert.equal(roundsRoom.status, 'waiting');
    assert.equal(roundsRoom.round, round + 1);
    assert.equal(roundsRoom.routeHidden, true);
  }
}

const roundsRematch = await api(
  'POST',
  `/rooms/${roundsCreated.session.code}/action`,
  { action: 'rematch', hostToken: roundsCreated.session.hostToken },
);
assert.equal(roundsRematch.room.status, 'waiting');
assert.equal(roundsRematch.room.round, 1);
assert.equal(roundsRematch.room.totalRounds, 3);
assert.equal(roundsRematch.room.players.every((player) => player.score === 0), true);

socket.close(1000, 'test complete');
await new Promise((resolve) => setTimeout(resolve, 150));

console.log(JSON.stringify({
  ok: true,
  koreanDate: daily.route.dateKey,
  roomCode: code,
  players: finished.room.players.map((player) => player.nickname),
  route: `${finished.room.startTitle} → ${finished.room.goalTitle}`,
}));
