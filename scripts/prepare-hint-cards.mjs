// Maintainer-only, opt-in importer. Never imported by the game server or clients.
// Prints a candidate JSON catalog to stdout for review before committing it.
// --base64 avoids broken UTF-8 when a terminal splits multi-byte output chunks.
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WORD_POOL } from '../shared/routes.mjs';
import { RANDOM_TITLE_POOL } from '../shared/random-title-pool.mjs';
import { comparableWikiTitle, isExactWikipediaArticle, wikipediaHintFromResponses } from '../shared/wikipedia-hints.mjs';

const known = new Set(RANDOM_TITLE_POOL);
const seeds = [...new Set([...WORD_POOL, '갈륨', '연필', '도서관', '커피', '피아노', '광합성', '라디오', '반도체', '박물관', '지도'])].filter(t => known.has(t));
const parser = new Miniflare(convertV4MiniflareOptions({ modules: true, compatibilityDate: '2026-09-02', script: `
export default { async fetch(request) {
  const links = [];
  const html = await request.text();
  const cleaned = await new HTMLRewriter().on('table, nav, aside, .hatnote, .navbox, .metadata, sup', { element(e) { e.remove(); } }).transform(new Response(html)).text();
  await new HTMLRewriter().on('p a[href]', { element(e) {
    const href = e.getAttribute('href');
    if (href.startsWith('/wiki/') && !href.includes('#')) {
      try { links.push(decodeURIComponent(href.slice(6)).replaceAll('_', ' ')); } catch {}
    }
  } }).transform(new Response(cleaned)).text();
  return Response.json([...new Set(links)]);
} };` }));
async function get(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'NamuRaceHintCatalog/1.0 (https://github.com/YJH0501/namu-race-online)' }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  if ([403, 429].includes(response.status)) throw new Error(`STOP: upstream denied requests (${response.status})`);
  if (!response.ok) return null;
  return response.json();
}
const cards = [], skipped = [], errors = [];
try {
  for (const title of seeds) {
    try {
      const page = await get('https://ko.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title));
      if (!isExactWikipediaArticle(title, page)) { skipped.push(title); continue; }
      const url = new URL('https://ko.wikipedia.org/w/api.php');
      url.search = new URLSearchParams({ action: 'parse', format: 'json', formatversion: '2', pageid: String(page.pageid), section: '0', prop: 'text|categories|properties|revid' });
      const parsed = (await get(url))?.parse;
      if (!parsed || parsed.pageid !== page.pageid || comparableWikiTitle(parsed.title) !== comparableWikiTitle(title)
          || Object.hasOwn(parsed.properties || {}, 'disambiguation')) { skipped.push(title); continue; }
      const data = wikipediaHintFromResponses(title, page, { ns: 0, pageid: page.pageid, title: page.title,
        categories: (parsed.categories || []).map(c => ({ title: '분류:' + c.category.replaceAll('_', ' '), ...(c.hidden ? { hidden: true } : {}) })) });
      const links = await (await parser.dispatchFetch('https://parser', { method: 'POST', body: parsed.text })).json();
      const relatedTitles = links.filter(t => known.has(t) && comparableWikiTitle(t) !== comparableWikiTitle(title)
        && !/:|^\d|국제 음성 기호|라틴어|그리스어|영어|한국어|일본어|중국어|프랑스어|독일어|한자|로마자|음역|어원/.test(t)).slice(0, 3);
      if (!data?.summary || relatedTitles.length < 2) { skipped.push(title); continue; }
      cards.push({ title, ...data, relatedTitles, sourceRevision: parsed.revid, reviewed: false });
    } catch (error) {
      if (error.message.startsWith('STOP:')) throw error;
      skipped.push(title);
      errors.push(title + ': ' + error.message);
    }
  }
  const output = JSON.stringify({ version: 'candidate', preparedAt: new Date().toISOString(), cards, skipped, errors }, null, 2);
  console.log(process.argv.includes('--base64') ? Buffer.from(output).toString('base64') : output);
} finally { await parser.dispose(); }
