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
  nextTitle: '인공지능',
});
const finished = await api('POST', `/rooms/${code}/action`, {
  action: 'progress',
  playerId: created.session.playerId,
  playerToken: created.session.playerToken,
  nextTitle: '인공지능',
});
assert.equal(finished.room.status, 'finished');
assert.equal(finished.room.players.every((player) => player.finishedAt), true);

socket.close(1000, 'test complete');
await new Promise((resolve) => setTimeout(resolve, 150));

console.log(JSON.stringify({
  ok: true,
  koreanDate: daily.route.dateKey,
  roomCode: code,
  players: finished.room.players.map((player) => player.nickname),
  route: `${finished.room.startTitle} → ${finished.room.goalTitle}`,
}));
