export function calculateRoundScoreDetails(players, startedAt, weights = { clicks: 600, time: 400 }) {
  const finishers = players
    .filter((player) => Number.isFinite(player.finishedAt))
    .map((player) => ({
      id: player.id,
      clicks: Math.max(1, Number(player.clicks) || 1),
      elapsedMs: Math.max(1, Number(player.finishedAt) - Number(startedAt)),
    }));

  if (!finishers.length) {
    return Object.fromEntries(players.map((player) => [player.id, { score: 0, clickScore: 0, timeScore: 0 }]));
  }

  const bestClicks = Math.min(...finishers.map((player) => player.clicks));
  const bestElapsedMs = Math.min(
    ...finishers.map((player) => player.elapsedMs),
  );
  const finisherScores = new Map(
    finishers.map((player) => [
      player.id,
      { clickScore: Math.round(weights.clicks * (bestClicks / player.clicks)),
        timeScore: Math.round(weights.time * (bestElapsedMs / player.elapsedMs)),
        bestClicks, bestElapsedMs },
    ]),
  );

  return Object.fromEntries(
    players.map((player) => {
      const detail = finisherScores.get(player.id) || { clickScore: 0, timeScore: 0, bestClicks, bestElapsedMs };
      return [player.id, { ...detail, score: detail.clickScore + detail.timeScore }];
    }),
  );
}

export function calculateRoundScores(players, startedAt, weights) {
  const details = calculateRoundScoreDetails(players, startedAt, weights);
  return Object.fromEntries(players.map((player) => [player.id, details[player.id]?.score || 0]));
}
