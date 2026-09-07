// No per-race copies or full scans of the 100,000-title catalog in the normal path.
export function uniformIndex(length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 0x100000000) throw new RangeError('Invalid catalog length');
  if (length === 1) return 0;
  const ceiling = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0] >= ceiling);
  return buffer[0] % length;
}

export function pickCatalogTitle(pool, excluded = new Set(), index = uniformIndex) {
  if (!pool.length) return null;
  for (let attempt = 0; attempt < 128; attempt++) {
    const title = pool[index(pool.length)];
    if (!excluded.has(title)) return title;
  }
  // Bounded fallback for tiny pools or exclusions covering most of the catalog.
  let available = 0;
  for (const title of pool) if (!excluded.has(title)) available++;
  if (!available) return null;
  let rank = index(available);
  for (const title of pool) if (!excluded.has(title) && rank-- === 0) return title;
  return null;
}

export function pickCatalogRoute(pool, recent = [], roomRecent = [], index = uniformIndex) {
  const excluded = new Set([...recent, ...roomRecent]);
  const goalTitle = pickCatalogTitle(pool, excluded, index)
    ?? pickCatalogTitle(pool, new Set(roomRecent), index)
    ?? pickCatalogTitle(pool, new Set(), index);
  if (!goalTitle) throw new Error('목표 문서 목록이 비어 있어요.');
  excluded.add(goalTitle);
  const startTitle = pickCatalogTitle(pool, excluded, index)
    ?? pickCatalogTitle(pool, new Set([goalTitle]), index);
  if (!startTitle) throw new Error('서로 다른 문서가 두 개 이상 필요해요.');
  return { startTitle, goalTitle };
}
