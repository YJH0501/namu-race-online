// Only used for the private server-to-server hint-cache response, never client text.
export function validDocumentHint(data, goalTitle) {
  if (!data || data.source !== 'namuwiki' ||
      typeof data.sourceTitle !== 'string' || !data.sourceTitle || data.sourceTitle.length > 200 ||
      data.sourceUrl !== 'https://namu.wiki/w/' + encodeURIComponent(data.sourceTitle) ||
      !Array.isArray(data.categories) || data.categories.length > 3 ||
      !data.categories.every(c => typeof c === 'string' && c.length <= 60) ||
      typeof data.summary !== 'string' || data.summary.length > 220) return false;
  if (data.sourceTitle === goalTitle) return true; // Existing exact-title cache entries.
  const chain = data.redirectChain;
  return data.requestedTitle === goalTitle && Array.isArray(chain) &&
    chain.length >= 2 && chain.length <= 6 &&
    chain[0] === goalTitle && chain.at(-1) === data.sourceTitle &&
    chain.every(t => typeof t === 'string' && t.length > 0 && t.length <= 200 && !/[\p{Cc}]/u.test(t)) &&
    new Set(chain).size === chain.length;
}
