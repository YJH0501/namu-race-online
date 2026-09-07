// Opt-in, bounded current-reader sample. Never crawl the complete catalog.
// Stops on access denial; reports failures without automatic evasive retries.
import {existsSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {RANDOM_TITLE_POOL, RANDOM_CATALOG} from '../shared/random-title-pool.mjs';

const seed=process.env.NAMU_CATALOG_SAMPLE_SEED || 'namu-catalog-live-check-v1';
const output=process.env.NAMU_CATALOG_SAMPLE_OUTPUT || 'docs/catalog-live-sample-2026-09-07.json';
if(existsSync(output)) throw Error('Preserve existing evidence: choose a new NAMU_CATALOG_SAMPLE_OUTPUT path.');
const rank=t=>createHash('sha256').update(seed+'\0'+t).digest('hex');
const raw=execFileSync('git',['show','85baf35a2c413ead6624458e447ae44c622f705b:shared/random-title-pool.mjs'],{encoding:'utf8',maxBuffer:4*1024*1024});
const original=new Set(JSON.parse(raw.slice(raw.indexOf('Object.freeze(')+14,raw.lastIndexOf(');'))));
const groups={added:RANDOM_TITLE_POOL.filter(t=>!original.has(t)),seed:RANDOM_TITLE_POOL.filter(t=>original.has(t))};
const sample=Object.entries(groups).flatMap(([group,titles])=>titles.map(title=>({title,group,rank:rank(title)})).sort((a,b)=>a.rank<b.rank?-1:1).slice(0,group==='added'?80:20));
const compiled=await build({stdin:{resolveDir:process.cwd(),contents:`
import {plainText} from './shared/document-hint.ts';
export default { async fetch(r) {
 const {html}=await r.json(); let title='',links=0,heading='',missing=false;
 const out=new HTMLRewriter()
 .on('meta[property="og:title"]',{element(e){title=plainText(e.getAttribute('content')||'',200)}})
 .on('h1',{text(t){heading+=t.text}})
 .on('[data-namu-title]',{element(e){const t=e.getAttribute('data-namu-title')||''; if(t&&!/^(파일|분류|틀|나무위키|사용자):/.test(t))links++}})
 .on('article',{text(t){if(/이 문서가 존재하지|문서가 존재하지 않습니다|해당 문서를 찾을 수 없/.test(t.text))missing=true}})
 .transform(new Response(html)); await out.arrayBuffer();
 return Response.json({title,heading:plainText(heading,200),links,missing});
}};`},bundle:true,format:'esm',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-02'}));
const report={catalog:RANDOM_CATALOG,seed,startedAt:new Date().toISOString(),requested:sample.length,records:[]};
try {
 for(const {title,group} of sample) {
  let status=0, html='', error='', page=null;
  const started=performance.now();
  try {
   const r=await fetch('https://namu-race.yangkun050178.chatgpt.site/api/article?title='+encodeURIComponent(title),{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'NamuRaceCatalogCheck/1.0 (https://github.com/YJH0501/namu-race-online)'}});
   status=r.status;const reader=r.body.getReader();const chunks=[];let size=0;
   try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024)throw Error('Response size limit');chunks.push(value)}}finally{await reader.cancel()}
   html=Buffer.concat(chunks).toString('utf8');
   if(status===200)page=await (await mf.dispatchFetch('https://analysis/',{method:'POST',body:JSON.stringify({html})})).json();
  } catch(e) {error=e.message}
  const denied=[403,429].includes(status)||/\(403\)|\(429\)|Just a moment|보안 확인/.test(html);
  const exact=Boolean(status===200&&page?.title===title&&!page?.missing);
  report.records.push({title,group,status,ms:Math.round(performance.now()-started),exact,page,...(error?{error}:{})});
  if(report.records.length%10===0)console.log('Current-source sample '+report.records.length+'/'+sample.length);
  if(denied){report.stopped='access-denied';break}
  await new Promise(r=>setTimeout(r,600));
 }
 report.finishedAt=new Date().toISOString();
 report.summary=Object.fromEntries(['added','seed'].map(group=>{const rows=report.records.filter(r=>r.group===group);return[group,{attempted:rows.length,exact:rows.filter(r=>r.exact).length,withArticleLinks:rows.filter(r=>r.exact&&r.page?.links>0).length}]}));
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,summary:report.summary,stopped:report.stopped}));
}finally{await mf.dispose()}
