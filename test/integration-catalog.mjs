import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {execFileSync} from 'node:child_process';
import {RANDOM_TITLE_POOL,RANDOM_CATALOG} from '../shared/random-title-pool.mjs';
const raw=execFileSync('git',['show','85baf35a2c413ead6624458e447ae44c622f705b:shared/random-title-pool.mjs'],{encoding:'utf8',maxBuffer:4*1024*1024});
const previous=new Set(JSON.parse(raw.slice(raw.indexOf('Object.freeze(')+14,raw.lastIndexOf(');'))));
const known=new Set(RANDOM_TITLE_POOL);
const compiled=await build({entryPoints:['server/src/index-final-v2.ts'],bundle:true,format:'esm',write:false,external:['cloudflare:workers']});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-09-02',durableObjects:{RACE_ROOMS:{className:'RaceRoom',useSQLite:true}},outboundService:()=>{throw Error('Catalog selection must not fetch documents')}}));
const api=async(path,body)=>{const r=await mf.dispatchFetch('https://game'+path,{method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d};
const action=(s,type,extra={})=>api('/rooms/'+s.code+'/action',{action:type,playerId:s.playerId,playerToken:s.playerToken,...extra});
const drawn=new Set(); let additions=0;
const check=r=>{assert.notEqual(r.startTitle,r.goalTitle);for(const title of [r.startTitle,r.goalTitle]){assert.ok(known.has(title));assert.ok(!drawn.has(title),'Recent titles should not repeat');drawn.add(title);if(!previous.has(title))additions++}};
try {
 assert.deepEqual((await api('/health')).catalog,RANDOM_CATALOG);
 const daily=(await api('/daily')).route;
 const day=await api('/rooms',{nickname:'일일검사',mode:'daily'});
 assert.equal(day.room.goalTitle,daily.goalTitle);assert.equal(day.room.startTitle,daily.startTitle);
 await action(day.session,'leave');
 for(let i=0;i<40;i++) {
  const made=await api('/rooms',{nickname:'랜덤검사',mode:'random'});
  assert.equal(made.room.hintGoalCount,100000);assert.equal(made.room.randomStartCount,100000);
  assert.equal(made.room.catalogVersion,RANDOM_CATALOG.version);
  assert.equal(made.room.startTitle,null);assert.equal(made.room.goalTitle,null);
  const started=await action(made.session,'start',{hostToken:made.session.hostToken});check(started.room);
  await action(made.session,'leave');
 }
 const made=await api('/rooms',{nickname:'프로그램',mode:'rounds',roundCount:3});const h=made.session;
 const g=(await api('/rooms/'+h.code+'/join',{nickname:'웹친구'})).session;
 for(let round=1;round<=3;round++) {
  await action(g,'ready');
  const {room}=await action(h,'start',{hostToken:h.hostToken});check(room);
  const guest=(await api('/rooms/'+h.code+'?playerId='+g.playerId+'&token='+g.playerToken)).room;
  assert.equal(guest.startTitle,room.startTitle);assert.equal(guest.goalTitle,room.goalTitle);
  await action(h,'forfeit');const result=await action(g,'forfeit');
  assert.equal(result.room.status,round===3?'finished':'round_result');
  if(round<3){const next=await action(h,'next-round',{hostToken:h.hostToken});assert.equal(next.room.goalTitle,null)}
 }
 const replay=await action(h,'rematch',{hostToken:h.hostToken});assert.equal(replay.room.mode,'rounds');assert.equal(replay.room.totalRounds,3);
 await action(h,'leave');await action(g,'leave');assert.ok(additions>0);
 console.log(JSON.stringify({ok:true,catalogCount:100000,randomRooms:40,crossClientRounds:3,drawnTitles:drawn.size,newCatalogDraws:additions,noSelectionNetworkRequests:true}));
}finally{await mf.dispose()}
