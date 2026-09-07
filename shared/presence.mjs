export const PRESENCE_TIMEOUT_MS = 120_000;
export function presenceDeadline(player) {
  return Math.max(player.lastSeenAt || player.joinedAt || 0, player.disconnectedAt || 0) + PRESENCE_TIMEOUT_MS;
}
