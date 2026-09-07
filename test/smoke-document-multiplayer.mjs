import assert from 'node:assert/strict';
const origin=process.env.NAMU_RACE_TEST_URL;
if(!origin)throw Error('Set NAMU_RACE_TEST_URL explicitly');
const site='https://namu-race.yangkun050178.chatgpt.site';
const sessions=[];
const api=async(path,body)=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;};
const action=(s,a,x={})=>api('/rooms/'+s.code+'/action',{action:a,playerId:s.playerId,playerToken:s.playerToken,...x});
const view=s=>api('/rooms/'+s.code+'?playerId='+s.playerId+'&token='+s.playerToken);
try {
 const made=await api('/rooms',{nickname:'검증윈도우',mode:'custom',startTitle:'비행기',goalTitle:'호버링'});const h=made.session;sessions.push(h);
 const g=(await api('/rooms/'+h.code+'/join',{nickname:'검증웹'})).session;sessions.push(g);
 await action(g,'ready');const begun=(await action(h,'start',{hostToken:h.hostToken})).room;
 const ballot={startedAt:begun.startedAt,hintLevel:1};
 const one=(await action(h,'hint-vote',ballot)).room;assert.equal(one.hint.level,0);assert.equal(one.hint.prepareToken,null);
 await action(g,'hint-vote',ballot);const pending=(await view(h)).room;
 if(pending.hint.prepareToken){
  const token=pending.hint.prepareToken;
  const forbidden=await fetch(site+'/api/hints?code='+h.code+'&token='+token);assert.ok([403,409].includes(forbidden.status),'Preparing client cannot read a private cache payload');
  const results=await Promise.all([h,g].map(async s=>{
   const r=await fetch(site+'/api/hints',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:s.code,token}),signal:AbortSignal.timeout(22000)});
   const text=await r.text();assert.ok(r.ok||r.status===409,text);assert.ok(!text.includes('summary'),'No unreleased explanation in prepare response');
  }));assert.equal(results.length,2);
 }
 let a,b;
 for(let i=0;i<40;i++){a=(await view(h)).room;b=(await view(g)).room;if(a.hint.level===1&&b.hint.level===1)break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(a.hint.level,1);assert.equal(b.hint.level,1);assert.deepEqual(a.hint.categories,b.hint.categories);assert.equal(a.hint.summary,'');assert.equal(b.hint.summary,'');
 assert.equal(a.hint.source,'namuwiki');assert.equal(a.hint.sourceTitle,'호버링');
 console.log(JSON.stringify({ok:true,twoPlayers:true,majority:true,privateCacheReadBlocked:true,stageTwoHidden:true,source:a.hint.source,categories:a.hint.categories}));
} finally { for(const s of sessions)await action(s,'leave').catch(()=>{}); }
