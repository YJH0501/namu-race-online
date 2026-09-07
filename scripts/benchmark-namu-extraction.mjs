// Read-only follow-up: HTTP 200 is not counted as a usable explanation.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const baseline = JSON.parse(readFileSync(new URL('../docs/hint-benchmark-initial-2026-09-07.json', import.meta.url)));
const compiled = await build({ stdin: { contents: `import {extractDocumentHint as extractHint} from './shared/document-hint.ts';
export default { async fetch(r) { const {html,title}=await r.json(); return Response.json(await extractHint(html,title)); } };`, resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: compiled.outputFiles[0].text, compatibilityDate: '2026-09-02' }));
const report = { seed: baseline.seed, sampledAt: new Date().toISOString(), sampleSize: baseline.sampleSize, records: [] };
try {
  for (const {title} of baseline.records.slice(0, Number(process.env.NAMU_SAMPLE_LIMIT || 100))) {
    let status = 0, html = '', error = ''; const began = performance.now();
    try {
      const r = await fetch('https://namu-race.yangkun050178.chatgpt.site/api/article?title=' + encodeURIComponent(title), { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'NamuRaceHintBenchmark/1.0 (https://github.com/YJH0501/namu-race-online)', Accept: 'text/html' } });
      status = r.status;
      const reader = r.body.getReader(); let bytes = 0; const chunks = [];
      try { while (true) { const {value,done} = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2*1024*1024) throw Error('Response too large'); chunks.push(value); } } finally { await reader.cancel(); }
      html = Buffer.concat(chunks).toString('utf8');
    } catch (e) { error = e.message; }
    const denied = [403,429].includes(status) || /\(403\)|\(429\)|Just a moment|보안 확인/.test(html);
    const pageTitle = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || '';
    let hint = null;
    if (status === 200 && !denied) hint = await (await mf.dispatchFetch('https://test/', {method:'POST', body: JSON.stringify({html,title})})).json();
    const identity = pageTitle === title;
    report.records.push({title, status, ms:Math.round(performance.now()-began), pageTitle, identity, hint, ...(error ? {error} : {})});
    if (report.records.length % 10 === 0) console.error('Completed ' + report.records.length + ' / ' + baseline.sampleSize);
    if (denied) { report.stopped = 'access-denied'; break; }
    await new Promise(r=>setTimeout(r,350));
  }
  report.summary = { attempted: report.records.length, httpOk: report.records.filter(r=>r.status===200).length, exactIdentity: report.records.filter(r=>r.identity).length, summaryCandidates: report.records.filter(r=>r.identity && r.hint?.summary).length, categoryCandidates: report.records.filter(r=>r.identity && r.hint?.categories?.length).length };
  console.log(JSON.stringify(report).replace(/[^\x00-\x7f]/g, c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
} finally { await mf.dispose(); }
