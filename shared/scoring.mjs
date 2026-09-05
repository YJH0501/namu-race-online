export function calculateRoundScores(players, startedAt) {
  const finishers = players
    .filter((player) => Number.isFinite(player.finishedAt))
    .map((player) => ({
      id: player.id,
      clicks: Math.max(1, Number(player.clicks) || 1),
      elapsedMs: Math.max(1, Number(player.finishedAt) - Number(startedAt)),
    }));

  if (!finishers.length) {
    return Object.fromEntries(players.map((player) => [player.id, 0]));
  }

  const bestClicks = Math.min(...finishers.map((player) => player.clicks));
  const bestElapsedMs = Math.min(
    ...finishers.map((player) => player.elapsedMs),
  );
  const finisherScores = new Map(
    finishers.map((player) => [
      player.id,
      Math.round(
        700 * (bestClicks / player.clicks) +
          300 * (bestElapsedMs / player.elapsedMs),
      ),
    ]),
  );

  return Object.fromEntries(
    players.map((player) => [player.id, finisherScores.get(player.id) || 0]),
  );
}
