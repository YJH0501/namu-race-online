import test from 'node:test';
import assert from 'node:assert/strict';
import { customRoute, dailyRoute, randomRoute } from '../shared/routes.mjs';

test('오늘의 레이스는 같은 날짜에 같은 경로를 만든다', () => {
  assert.deepEqual(dailyRoute('2026-09-03'), dailyRoute('2026-09-03'));
  assert.notEqual(dailyRoute('2026-09-03').startTitle, dailyRoute('2026-09-03').goalTitle);
});

test('랜덤 레이스의 출발과 목표는 서로 다르다', () => {
  const values = [0.2, 0.2];
  const route = randomRoute(() => values.shift() ?? 0.2);
  assert.notEqual(route.startTitle, route.goalTitle);
});

test('사용자 지정 경로를 정리하고 같은 문서는 거부한다', () => {
  assert.equal(customRoute(' 인공_지능 ', ' 로봇 ').startTitle, '인공 지능');
  assert.throws(() => customRoute('서울', '서울'), /서로 달라야/);
});
