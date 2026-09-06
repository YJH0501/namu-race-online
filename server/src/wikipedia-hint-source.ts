// @ts-expect-error Shared pure ESM matching rules are covered by Node tests.
import { comparableWikiTitle, isExactWikipediaArticle, wikipediaHintFromResponses } from '../../shared/wikipedia-hints.mjs';

const ORIGIN = 'https://ko.wikipedia.org';
const USER_AGENT = 'NamuRace/0.4.3 (https://github.com/YJH0501/namu-race-online)';
const MAX_JSON_BYTES = 128 * 1024;

async function fetchJson(url: URL, signal: AbortSignal) {
  const response = await fetch(url.href, { signal, redirect: 'manual', headers: {
    Accept: 'application/json', 'User-Agent': USER_AGENT,
  } });
  // An exact-title fallback does not chase redirects or retry access denials.
  if (!response.ok || !response.headers.get('content-type')?.includes('json') || !response.body) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel(); }
}

export async function getWikipediaHint(title: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Wikipedia conventionally separates a parenthetical qualifier with a space.
    // This does not strip/change the qualifier: e.g. 영화 must still match 영화.
    const queryTitle = comparableWikiTitle(title).replace(/\(/g, ' (');
    const summary = await fetchJson(new URL(`/api/rest_v1/page/summary/${encodeURIComponent(queryTitle)}`, ORIGIN), controller.signal);
    if (!isExactWikipediaArticle(title, summary)) return null;
    const url = new URL('/w/api.php', ORIGIN);
    url.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2',
      pageids: String(summary.pageid), prop: 'categories|pageprops', clshow: '!hidden', cllimit: '20' }).toString();
    const metadata = await fetchJson(url, controller.signal);
    return wikipediaHintFromResponses(title, summary, metadata?.query?.pages?.[0]);
  } catch (error) {
    console.warn('WIKIPEDIA_HINT fetch failed', error instanceof Error ? error.message : 'unknown');
    return null;
  } finally { clearTimeout(timer); }
}
