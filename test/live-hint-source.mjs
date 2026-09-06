// Optional read-only source check. This does not replace deployed-DO smoke tests.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const wikipedia = process.argv.includes('--wikipedia');
const sourceImport = wikipedia ? "import {getWikipediaHint as getGoalHint} from './server/src/wikipedia-hint-source.ts';" : "import {getGoalHint} from './server/src/hint-source.ts';";
const compiled = await build({ stdin: { contents: sourceImport + "export default {async fetch(r){return Response.json(await getGoalHint(new URL(r.url).searchParams.get('title')))}};", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text,
  compatibilityDate: '2026-09-02', outboundService: async (request) => {
    const upstream = await fetch(request.url, { headers: request.headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: upstream.headers });
  },
}));
try {
  for (const title of (wikipedia ? ['고양이', '갈륨', '해저 2만리', '인공지능', '대한민국'] : ['인공지능', '해저 2만리', '대한민국'])) {
    const response = await mf.dispatchFetch(`https://hint/?title=${encodeURIComponent(title)}`);
    const hint = await response.json();
    assert.ok(hint?.categories.length || hint?.summary, `${title}: no usable hint`);
    assert.ok(hint.summary.length <= 220);
    if (wikipedia) assert.equal(hint.source, 'wikipedia');
    console.log(JSON.stringify({ title, ...hint }));
  }
} finally { await mf.dispose(); }
