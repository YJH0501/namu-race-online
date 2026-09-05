export const HINT_COOLDOWN_MS = 60_000;
export const HINT_LOAD_TIMEOUT_MS = 15_000;

export function newHintState() {
  return { level: 0, votes: [], status: 'idle', revealedAt: null, retryAt: 0,
    requestId: null, requestedAt: 0, categories: [], summary: '', sourceUrl: '' };
}

export function hintVoters(room) {
  return room.players.filter((player) => !player.finishedAt && !player.forfeitedAt);
}

export function hintVoteInfo(room, viewerId, now = Date.now()) {
  const hint = room.hint || newHintState();
  const voters = hintVoters(room);
  const ids = new Set(voters.map((player) => player.id));
  const votes = [...new Set(hint.votes)].filter((id) => ids.has(id));
  const nextAvailableAt = Math.max(hint.retryAt || 0,
    hint.level === 1 ? (hint.revealedAt || 0) + HINT_COOLDOWN_MS : 0);
  return { votes: votes.length, required: Math.floor(voters.length / 2) + 1,
    voted: votes.includes(viewerId), eligible: room.status === 'racing' && ids.has(viewerId),
    nextAvailableAt, canRequest: room.status === 'racing' && voters.length > 0 &&
      hint.level < 2 && hint.status !== 'loading' && now >= nextAvailableAt };
}

// Only released text is serialized. The second hint never reaches a client early.
export function publicHint(room, viewerId, now = Date.now()) {
  if (room.status === 'waiting' || !room.players.some((p) => p.id === viewerId)) return null;
  const hint = room.hint || newHintState();
  return { ...hintVoteInfo(room, viewerId, now), level: hint.level, status: hint.status,
    categories: hint.level >= 1 ? hint.categories : [],
    summary: hint.level >= 2 ? hint.summary : '',
    sourceUrl: hint.level >= 1 ? hint.sourceUrl : '' };
}

// Re-evaluate after finishes/departures as well as votes. Repeated requests are idempotent.
export function reconcileHint(room, now = Date.now()) {
  const hint = room.hint ||= newHintState();
  const ids = new Set(hintVoters(room).map((player) => player.id));
  hint.votes = [...new Set(hint.votes)].filter((id) => ids.has(id));
  if (hint.status === 'loading' && now - hint.requestedAt >= HINT_LOAD_TIMEOUT_MS) {
    hint.status = 'unavailable';
    hint.requestId = null;
    hint.votes = [];
    hint.retryAt = now + HINT_COOLDOWN_MS;
  }
  const info = hintVoteInfo(room, null, now);
  if (!info.canRequest || info.votes < info.required) return false;
  hint.status = 'loading';
  hint.requestId = crypto.randomUUID();
  hint.requestedAt = now;
  return true;
}

export function completeHint(room, requestId, data, now = Date.now()) {
  const hint = room.hint;
  if (!hint || hint.requestId !== requestId || hint.status !== 'loading' || room.status !== 'racing') return false;
  const available = data && (hint.level === 0 ? data.categories.length || data.summary : data.summary);
  hint.votes = [];
  hint.requestId = null;
  if (!available) {
    hint.status = 'unavailable';
    hint.retryAt = now + HINT_COOLDOWN_MS;
    return true;
  }
  hint.categories = data.categories;
  hint.summary = data.summary;
  hint.sourceUrl = data.sourceUrl;
  hint.level += 1;
  hint.status = 'ready';
  hint.revealedAt = now;
  hint.retryAt = 0;
  return true;
}

export function cleanHintText(value, max = 220) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', middot: '·' };
  const text = String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === 'x';
    const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }).replace(/<[^>]*>/g, '')
    .replace(/https?:\/\/\S+/gi, '').replace(/\[(?:\d+|주\s*\d+)\]/g, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

export function selectHintText(title, categories, paragraphs, description = '') {
  const selectedCategories = [...new Set(categories.map((text) => cleanHintText(text, 60)))]
    .filter((text) => text && text !== title && !/^(나무위키|분류:|틀:|토막글|편집|문서 관리)/.test(text)).slice(0, 3);
  const candidates = paragraphs.map((text) => cleanHintText(text, 600)).filter((text) =>
    text.length >= 25 && !/^\d+\.\s|펼치기|접기|넘겨주기|다른 뜻|이 문서는|이 문서의|이 저작물|CC BY|로그인|보안 확인|문서가 존재하지|없는 문서/.test(text));
  const plainTitle = title.replace(/\([^)]*\)$/, '').trim();
  const paragraph = candidates.find((text) => text.slice(0, 80).includes(plainTitle)) || candidates[0];
  const fallback = cleanHintText(description);
  const usableFallback = fallback.length >= 15 && !/문서가 존재하지|없는 문서|나무위키:대문|보안 확인|Just a moment/i.test(fallback) ? fallback : '';
  // Prefer an actual opening sentence; never synthesize a factual definition.
  const excerpt = paragraph?.match(/^.{15,}?[.!?](?=\s|$)/)?.[0] || paragraph || usableFallback;
  return { categories: selectedCategories, summary: cleanHintText(excerpt) };
}

export function createHintCache({ maxEntries = 512, ttlMs = 6 * 60 * 60 * 1000, now = Date.now } = {}) {
  const entries = new Map();
  const pending = new Map();
  return {
    get size() { return entries.size; },
    async get(title, fetchHint) {
      for (const [key, entry] of entries) if (entry.expires <= now()) entries.delete(key);
      const cached = entries.get(title);
      if (cached) { entries.delete(title); entries.set(title, cached); return cached.data; }
      if (pending.has(title)) return pending.get(title);
      // Bound concurrent distinct downloads as well as stored entries.
      if (pending.size >= 8) return null;
      const task = Promise.resolve().then(() => fetchHint(title)).catch(() => null).then((data) => {
        entries.set(title, { data, expires: now() + (data ? ttlMs : HINT_COOLDOWN_MS) });
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
        return data;
      }).finally(() => pending.delete(title));
      pending.set(title, task);
      return task;
    },
  };
}
