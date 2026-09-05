import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundScores, calculateRoundScoreDetails } from '../shared/scoring.mjs';

test('라운드 점수는 클릭 수 60%와 완주 시간 40%를 반영한다', () => {
  const scores = calculateRoundScores(
    [
      { id: 'balanced', clicks: 4, finishedAt: 11_000 },
      { id: 'fast', clicks: 8, finishedAt: 6_000 },
      { id: 'forfeit', clicks: 2, finishedAt: null },
    ],
    1_000,
  );

  assert.equal(scores.balanced, 800);
  assert.equal(scores.fast, 700);
  assert.equal(scores.forfeit, 0);
});

test('작은 시간 차이는 작은 점수 차이이고 동률은 같은 점수다', () => {
  const players = [{ id: 'a', clicks: 5, finishedAt: 101000 }, { id: 'b', clicks: 5, finishedAt: 102000 }, { id: 'c', clicks: 5, finishedAt: 101000 }];
  assert.deepEqual(calculateRoundScores(players, 1000), { a: 1000, b: 996, c: 1000 });
  const details = calculateRoundScoreDetails(players, 1000);
  assert.equal(details.b.clickScore, 600);
  assert.equal(details.b.timeScore, 396);
  assert.equal(details.b.score, details.b.clickScore + details.b.timeScore);
});

test('완주자가 없으면 모두 0점이며 과거 가중치도 재현할 수 있다', () => {
  assert.deepEqual(calculateRoundScores([{ id: 'a', clicks: 5, finishedAt: null }], 1000), { a: 0 });
  const players = [{ id: 'a', clicks: 4, finishedAt: 11000 }, { id: 'b', clicks: 8, finishedAt: 6000 }];
  assert.deepEqual(calculateRoundScores(players, 1000, { clicks: 700, time: 300 }), { a: 850, b: 650 });
});

test('클릭이나 시간이 늘어서 더 높은 점수를 받을 수 없다', () => {
  for (let clicks = 4; clicks < 20; clicks++) {
    let previous = 1001;
    for (let elapsed = 10; elapsed < 100; elapsed++) {
      const players = [{ id: 'best', clicks: 3, finishedAt: 5000 }, { id: 'test', clicks, finishedAt: elapsed * 1000 }];
      const score = calculateRoundScores(players, 0).test;
      assert.ok(score <= previous && score >= 0 && score <= 1000);
      previous = score;
    }
  }
});

test('각 기준의 최고 기록을 모두 세우면 1000점을 받는다', () => {
  const scores = calculateRoundScores(
    [{ id: 'winner', clicks: 3, finishedAt: 4_000 }],
    1_000,
  );
  assert.equal(scores.winner, 1000);
});
