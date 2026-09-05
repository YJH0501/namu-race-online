// Optional read-only smoke check against actual Namu Wiki markup, in the Worker parser.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const compiled = await build({ stdin: { contents: "import { getGoalHint } from './server/src/hint-source.ts'; export default { async fetch(r) { return Response.json(await getGoalHint(new URL(r.url).searchParams.get('title'))); } };", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text,
  compatibilityDate: '2026-09-02', outboundService: async (request) => {
    const upstream = await fetch(request.url, { headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(8000) });
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: upstream.headers });
  },
}));
try {
  for (const title of ['인공지능', '해저 2만리', '대한민국']) {
    const response = await mf.dispatchFetch(`https://hint/?title=${encodeURIComponent(title)}`);
    const hint = await response.json();
    assert.ok(hint?.categories.length || hint?.summary, `${title}: no usable hint`);
    assert.ok(hint.summary.length <= 220);
    console.log(JSON.stringify({ title, ...hint }));
  }
} finally { await mf.dispose(); }
