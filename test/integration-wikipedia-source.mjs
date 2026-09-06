import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const compiled = await build({ stdin: { contents: "import {getGoalHint} from './server/src/hint-source.ts'; export default {async fetch(r){return Response.json(await getGoalHint(new URL(r.url).searchParams.get('title')))}}", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const calls = [];
let summaryTitle;
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-09-02',
  outboundService: async (request) => {
    const url = new URL(request.url); calls.push(url);
    if (url.origin === 'https://namu-race.yangkun050178.chatgpt.site') {
      return new Response('<p>나무위키 문서를 불러오지 못했습니다. (403)</p>', { status: 502, headers: { 'content-type': 'text/html' } });
    }
    assert.equal(url.origin, 'https://ko.wikipedia.org');
    assert.match(request.headers.get('user-agent'), /NamuRace/);
    if (url.pathname.startsWith('/api/rest_v1/page/summary/')) {
      summaryTitle = decodeURIComponent(url.pathname.split('/summary/')[1]);
      if (summaryTitle === '요청제한') return Response.json({}, { status: 429 });
      if (summaryTitle === '잘못된JSON') return new Response('{invalid', { headers: { 'content-type': 'application/json' } });
      if (summaryTitle === '과대응답') return Response.json({ extract: 'x'.repeat(140000) });
      if (summaryTitle === '리디렉션') return new Response(null, { status: 302, headers: { location: 'https://example.com/private' } });
      return Response.json({ type: summaryTitle === '동음이의' ? 'disambiguation' : 'standard',
        namespace: { id: 0 }, pageid: 123, title: summaryTitle === '잘못된제목' ? '다른대상' : summaryTitle,
        extract: `${summaryTitle}은 정확한 문서의 설명이며 이 테스트에서 충분히 긴 원문으로 사용한다. 다른 문장.` });
    }
    assert.equal(url.pathname, '/w/api.php');
    return Response.json({ query: { pages: [{ title: summaryTitle, pageid: 123, ns: 0,
      categories: [{ title: '분류:검증 분류' }], pageprops: summaryTitle === '추가모호성' ? { disambiguation: '' } : {} }] } });
  },
}));
async function hint(title) { return (await mf.dispatchFetch(`https://test/?title=${encodeURIComponent(title)}`)).json(); }
try {
  const data = await hint('정확한문서');
  assert.equal(data.source, 'wikipedia');
  assert.deepEqual(data.categories, ['검증 분류']);
  assert.equal(calls.length, 3, 'Denied Namu request is not retried');
  assert.deepEqual(await hint('정확한문서'), data);
  assert.equal(calls.length, 3, 'Successful fallback is cached');
  for (const title of ['동음이의', '잘못된제목', '요청제한', '잘못된JSON', '과대응답', '리디렉션', '추가모호성']) {
    const before = calls.length;
    assert.equal(await hint(title), null, title);
    assert.equal(calls.length - before, title === '추가모호성' ? 3 : 2, title);
    const after = calls.length;
    assert.equal(await hint(title), null);
    assert.equal(calls.length, after, 'Failures are briefly cached, not hammered');
  }
  console.log(JSON.stringify({ ok: true, deniedSourceFallback: true, boundedJson: true, rejectMismatches: true, noDeniedRetries: true }));
} finally { await mf.dispose(); }
