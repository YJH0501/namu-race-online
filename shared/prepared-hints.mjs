import { getHintCard, HINT_CATALOG_VERSION } from './hint-catalog.mjs';
import { newHintState, reconcileHint, completeHint } from './hints.mjs';

export function newPreparedHintState(title) {
  const card = getHintCard(title);
  if (!card) return { ...newHintState(), format: 'document-v1', available: true, maxLevel: 2, snapshot: null, card: null, relatedTitles: [] };
  return { ...newHintState(), format: 'card-v1', available: Boolean(card),
    catalogVersion: HINT_CATALOG_VERSION, card: card ? structuredClone(card) : null,
    relatedTitles: [], status: card ? 'idle' : 'unavailable' };
}

// Keep a round's private card snapshot across deploys/hibernation. Never replace
// a released legacy hint mid-round; its stored stage-two excerpt remains usable.
export function prepareRoomHint(room) {
  if (room?.hint?.format === 'card-v1' && !room.hint.card && !room.hint.level) {
    const votes = room.hint.votes;
    room.hint = newPreparedHintState(room.goalTitle);
    room.hint.votes = votes;
    return true;
  }
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
  // Live-document stage one is prepared by the trusted reader and read back by
  // the server. Stage two always reuses the same persisted round snapshot.
  if (hint.format === 'document-v1' && !hint.snapshot) return true;
  if (hint.format === 'document-v1') return completeHint(room, hint.requestId, hint.snapshot, now);
  return completeHint(room, hint.requestId, hint.format === 'card-v1' ? hint.card : { ...hint }, now);
}
