import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundScores } from '../shared/scoring.mjs';

test('라운드 점수는 클릭 수와 완주 시간을 절반씩 반영한다', () => {
  const scores = calculateRoundScores(
    [
      { id: 'balanced', clicks: 4, finishedAt: 11_000 },
      { id: 'fast', clicks: 8, finishedAt: 6_000 },
      { id: 'forfeit', clicks: 2, finishedAt: null },
    ],
    1_000,
  );

  assert.equal(scores.balanced, 750);
  assert.equal(scores.fast, 750);
  assert.equal(scores.forfeit, 0);
});

test('각 기준의 최고 기록을 모두 세우면 1000점을 받는다', () => {
  const scores = calculateRoundScores(
    [{ id: 'winner', clicks: 3, finishedAt: 4_000 }],
    1_000,
  );
  assert.equal(scores.winner, 1000);
});
