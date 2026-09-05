import assert from 'node:assert/strict';
import { koreaDateKey } from '../shared/korea-date.mjs';

const baseUrl = process.env.NAMU_RACE_TEST_URL || 'http://127.0.0.1:8787';

async function create(body) {
  const response = await fetch(`${baseUrl}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname: '모드검사', ...body }),
  });
  const data = await response.json();
  assert.equal(response.ok, true, data.error);
  return data.room;
}

const daily = await create({ mode: 'daily' });
assert.equal(daily.mode, 'daily');
assert.equal(daily.dateKey, koreaDateKey());

const random = await create({ mode: 'random' });
assert.equal(random.mode, 'random');
assert.equal(random.routeHidden, true);
assert.equal(random.startTitle, null);
assert.equal(random.goalTitle, null);

const custom = await create({ mode: 'custom', startTitle: ' 고양이 ', goalTitle: '우주_탐사' });
assert.equal(custom.mode, 'custom');
assert.equal(custom.startTitle, '고양이');
assert.equal(custom.goalTitle, '우주 탐사');

const rounds = await create({ mode: 'rounds', roundCount: 5 });
assert.equal(rounds.mode, 'rounds');
assert.equal(rounds.totalRounds, 5);
assert.equal(rounds.routeHidden, true);

console.log(JSON.stringify({
  ok: true,
  daily: `${daily.startTitle} → ${daily.goalTitle}`,
  random: '시작 시 공개',
  custom: `${custom.startTitle} → ${custom.goalTitle}`,
  rounds: `${rounds.totalRounds}라운드 · 시작 시 공개`,
}));
