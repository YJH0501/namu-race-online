import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const compiled=await build({entryPoints:['test/hints-worker.ts'],bundle:true,format:'esm',write:false,external:['cloudflare:workers']});
let ready=false, calls=0;
const goal='테크볼';
const source={source:'namuwiki',sourceTitle:goal,sourceUrl:'https://namu.wiki/w/'+encodeURIComponent(goal),sourceLicense:'CC BY-NC-SA 2.0 KR',categories:['스포츠'],summary:'테크볼은 축구와 탁구를 결합한 스포츠이다.'};
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-02',durableObjects:{RACE_ROOMS:{className:'RaceRoom',useSQLite:true}},outboundService:async r=>{
 const u=new URL(r.url);assert.equal(u.origin,'https://namu-race.yangkun050178.chatgpt.site');assert.equal(u.pathname,'/api/hints');assert.equal(r.method,'GET');calls++;
 // Exercise real re-entrant DO ticket validation, just as the Site does.
 const context=await mf.dispatchFetch('https://game/rooms/'+u.searchParams.get('code')+'/hint-context?token='+u.searchParams.get('token'));
 if(context.status!==200)return new Response(null,{status:409});
 const claim=await context.json();assert.equal(claim.goalTitle,goal);assert.equal(claim.canRead,true,'Only the server owns a cache-read token');
 return Response.json({ready,hint:ready?source:null});
}}));
const api=async(path,body,status=200)=>{const r=await mf.dispatchFetch('https://game'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
const action=(s,a,x={},status=200)=>api('/rooms/'+s.code+'/action',{action:a,playerId:s.playerId,playerToken:s.playerToken,...x},status);
const view=s=>api('/rooms/'+s.code+'?playerId='+s.playerId+'&token='+s.playerToken);
try{
 const made=await api('/rooms',{nickname:'윈도우',mode:'custom',startTitle:'축구',goalTitle:goal});const h=made.session,g=(await api('/rooms/'+h.code+'/join',{nickname:'웹친구'})).session;
 assert.equal(made.room.hint,null);assert.equal(calls,0);
 await api('/rooms/'+h.code+'/hint-context?token=wrong',undefined,409);
 await action(g,'ready');const started=(await action(h,'start',{hostToken:h.hostToken})).room;
 const ballot={startedAt:started.startedAt,hintLevel:1};await action(h,'hint-vote',ballot);assert.equal(calls,0);
 await action(g,'hint-vote',ballot);let loading=(await view(h)).room;const id=loading.hint.prepareToken;assert.ok(id);assert.equal(loading.hint.summary,'');
 await action(h,'hint-ready',{startedAt:started.startedAt,requestId:'fake',summary:'위조 설명'},409);
 ready=true;
 await action(g,'hint-ready',{startedAt:started.startedAt,requestId:id,summary:'위조 설명'});
 let first;
 for(let i=0;i<160;i++){first=(await view(h)).room;if(first.hint.level===1)break;await new Promise(r=>setTimeout(r,25));}
 assert.equal(first.hint.level,1);assert.deepEqual(first.hint.categories,['스포츠']);assert.equal(first.hint.summary,'');assert.equal(first.hint.snapshot,undefined);assert.equal(first.hint.prepareToken,null);
 assert.equal((await view(g)).room.hint.level,1);await api('/rooms/'+h.code+'/hint-context?token='+id,undefined,409);
 const ns=await mf.getDurableObjectNamespace('RACE_ROOMS');await ns.get(ns.idFromName(h.code)).fetch('https://room/__test/advance-hint');
 const before=calls;await action(h,'hint-vote',{...ballot,hintLevel:2});await action(g,'hint-vote',{...ballot,hintLevel:2});const second=(await view(g)).room;
 assert.equal(second.hint.summary,source.summary);assert.equal(second.hint.level,2);assert.equal(calls,before,'Stage two uses persisted snapshot, not changing remote content');
 await action(h,'forfeit');await action(g,'forfeit');await action(h,'rematch',{hostToken:h.hostToken});
 await action(h,'hint-ready',{startedAt:started.startedAt,requestId:id},409);
 await action(h,'leave');await action(g,'leave');
 console.log(JSON.stringify({ok:true,cacheReads:calls,noSourceDownloads:true,reentrantContext:true,noForgedHints:true,noEarlyLeak:true,twoPlayers:true,snapshotStageTwo:true,staleRoundRejected:true}));
}finally{await mf.dispose();}
