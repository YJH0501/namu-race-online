import { getHintCard, HINT_CATALOG_VERSION } from './hint-catalog.mjs';
import { newHintState, reconcileHint, completeHint } from './hints.mjs';

export function newPreparedHintState(title) {
  const card = getHintCard(title);
  return { ...newHintState(), format: 'card-v1', available: Boolean(card),
    catalogVersion: HINT_CATALOG_VERSION, card: card ? structuredClone(card) : null,
    relatedTitles: [], status: card ? 'idle' : 'unavailable' };
}

// Keep a round's private card snapshot across deploys/hibernation. Never replace
// a released legacy hint mid-round; its stored stage-two excerpt remains usable.
export function prepareRoomHint(room) {
  if (!room || room.hint?.format) return false;
  const previous = room.hint;
  if (previous?.level > 0) {
    previous.format = 'legacy';
    previous.available = Boolean(previous.summary) || previous.level >= 2;
    previous.requestId = null;
    previous.retryAt = 0;
    previous.status = previous.available ? 'ready' : 'unavailable';
  } else {
    room.hint = newPreparedHintState(room.goalTitle);
    room.hint.votes = previous?.votes || [];
  }
  return true;
}

export function reconcilePreparedHint(room, now = Date.now()) {
  if (!room) return false;
  prepareRoomHint(room);
  if (!reconcileHint(room, now)) return false;
  const hint = room.hint;
  // Deliberately synchronous: no HTTP, cache miss, deferred task or retry loop.
  return completeHint(room, hint.requestId, hint.format === 'card-v1' ? hint.card : { ...hint }, now);
}
