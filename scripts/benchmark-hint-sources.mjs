// Opt-in read-only experiment. Does not write to the game or alter its goal pool.
import { createHash } from 'node:crypto';
import { RANDOM_TITLE_POOL } from '../shared/random-title-pool.mjs';
import { getHintCard } from '../shared/hint-catalog.mjs';
import { comparableWikiTitle, wikipediaHintFromResponses } from '../shared/wikipedia-hints.mjs';

const seed = 'namu-hint-benchmark-v1-2026-09-07';
const sample = [...RANDOM_TITLE_POOL].map(title => ({ title, hash: createHash('sha256').update(seed + '\0' + title).digest('hex') }))
  .sort((a, b) => a.hash.localeCompare(b.hash)).slice(0, 100).map(x => x.title);
const report = { seed, sampledAt: new Date().toISOString(), population: RANDOM_TITLE_POOL.length,
  sampleSize: sample.length, requests: [], namu: [], records: sample.map(title => ({ title, prepared: Boolean(getHintCard(title)) })) };
const blocked = new Set();
const pause = () => new Promise(r => setTimeout(r, 350));
async function get(url, kind, json = true) {
  const endpoint = new URL(url).origin;
  if (blocked.has(endpoint)) return null;
  const began = performance.now(); let status = 0, error = '';
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: {
      'User-Agent': 'NamuRaceHintBenchmark/1.0 (https://github.com/YJH0501/namu-race-online)',
      Accept: json ? 'application/json' : 'text/html',
    } });
    status = r.status;
    if ([403, 429].includes(status)) blocked.add(endpoint);
    if (!r.ok) { await r.body?.cancel(); return null; }
    const reader = r.body.getReader(); let bytes = 0, chunks = [];
    try { while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 2 * 1024 * 1024) throw Error('Response too large');
      chunks.push(value);
    } } finally { await reader.cancel(); }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!json && /\(403\)|\(429\)|Just a moment|보안 확인/.test(text)) blocked.add(endpoint);
    return json ? JSON.parse(text) : text;
  } catch (e) { error = e.message; return null; }
  finally { report.requests.push({ kind, endpoint, status, ms: Math.round(performance.now() - began), ...(error ? { error } : {}) }); await pause(); }
}

// Stop after an access denial, rather than hammering a blocked source 100 times.
for (const title of sample.slice(0, 5)) {
  const url = 'https://namu-race.yangkun050178.chatgpt.site/api/article?title=' + encodeURIComponent(title);
  const html = await get(url, 'namu-reader', false);
  const last = report.requests.at(-1);
  report.namu.push({ title, status: last.status, available: Boolean(html && !blocked.has(new URL(url).origin)),
    reason: html?.match(/<p>([^<]*불러오[^<]*)<\/p>/)?.[1] || (last.status === 502 ? 'reader upstream failure' : '') });
  // The current reader wraps upstream denials in a 502. Do not change source/IP.
  if (!html || blocked.has(new URL(url).origin)) break;
}

// Batch metadata first; download introductions only for exact, non-ambiguous pages.
const metadata = new Map();
for (let offset = 0; offset < sample.length; offset += 25) {
  const u = new URL('https://ko.wikipedia.org/w/api.php');
  u.search = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', maxlag: '5',
    titles: sample.slice(offset, offset + 25).map(t => comparableWikiTitle(t).replace(/\(/g, ' (')).join('|'),
    prop: 'info|pageprops|categories', clshow: '!hidden', cllimit: 'max' });
  const result = await get(u, 'wikipedia-metadata');
  for (const page of result?.query?.pages || []) metadata.set(comparableWikiTitle(page.title), page);
}
for (const record of report.records) {
  const page = metadata.get(comparableWikiTitle(record.title));
  if (!page || page.missing !== undefined || page.ns !== 0 || page.redirect !== undefined || Object.hasOwn(page.pageprops || {}, 'disambiguation')) {
    record.wikipedia = { candidate: false, reason: !page ? 'not-queried-or-error' : page.missing !== undefined ? 'missing' : page.redirect !== undefined ? 'redirect-not-identity-proof' : 'not-standard' };
    continue;
  }
  const summary = await get('https://ko.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(page.title), 'wikipedia-summary');
  const hint = wikipediaHintFromResponses(record.title, summary, page);
  record.wikipedia = { candidate: Boolean(hint), verifiedIdentity: false, pageId: page.pageid,
    entityId: page.pageprops?.wikibase_item || '', ...(hint ? { hint } : { reason: 'no-usable-introduction' }) };
}

// Match an explicit Namuwiki article ID, not fuzzy labels or similar names.
for (let offset = 0; offset < sample.length; offset += 20) {
  const batch = sample.slice(offset, offset + 20);
  const query = `PREFIX wdt: <http://www.wikidata.org/prop/direct/> PREFIX schema: <http://schema.org/>
    SELECT ?title ?item ?description ?article WHERE {
      VALUES ?title { ${batch.map(t => JSON.stringify(t)).join(' ')} }
      ?item wdt:P8885 ?title .
      OPTIONAL { ?item schema:description ?description . FILTER(LANG(?description) = "ko") }
      OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://ko.wikipedia.org/> }
    }`;
  const u = new URL('https://query.wikidata.org/sparql'); u.search = new URLSearchParams({ query, format: 'json' });
  const result = await get(u, 'wikidata-explicit-id');
  for (const title of batch) {
    const record = report.records.find(r => r.title === title);
    const rows = result?.results?.bindings.filter(r => r.title?.value === title) || [];
    const ids = [...new Set(rows.map(r => r.item?.value))];
    record.wikidata = { tested: Boolean(result?.results), matched: ids.length === 1,
      ...(ids.length === 1 ? { entityUrl: ids[0], description: rows[0].description?.value || '', articleUrl: rows[0].article?.value || '' } : {}) };
    if (record.wikipedia?.candidate && ids.length === 1 && ids[0].endsWith('/' + record.wikipedia.entityId)) record.wikipedia.verifiedIdentity = true;
  }
}
report.summary = {
  prepared: report.records.filter(r => r.prepared).length,
  wikipediaCandidates: report.records.filter(r => r.wikipedia?.candidate).length,
  wikipediaIdentityConfirmed: report.records.filter(r => r.wikipedia?.verifiedIdentity).length,
  wikidataTested: report.records.filter(r => r.wikidata?.tested).length,
  wikidataMatches: report.records.filter(r => r.wikidata?.matched).length,
  wikidataKoreanDescriptions: report.records.filter(r => r.wikidata?.matched && r.wikidata.description).length,
  namuAttempted: report.namu.length, namuAvailable: report.namu.filter(r => r.available).length,
  verifiedNamuRouteHints: 'not measured: no pre-existing Namu link graph; Wikipedia links are not Namu links',
  requests: report.requests.length,
};
// ASCII JSON is safe across terminals which split UTF-8 chunks incorrectly.
console.log(JSON.stringify(report, null, 2).replace(/[^\x00-\x7f]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
