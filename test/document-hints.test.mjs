import test from 'node:test';
import assert from 'node:assert/strict';
import {newPreparedHintState,reconcilePreparedHint} from '../shared/prepared-hints.mjs';
import {publicHint,completeHint,hintVoteInfo} from '../shared/hints.mjs';
const make=()=>({status:'racing',goalTitle:'새로운 목표',players:[{id:'a'},{id:'b'}],hint:newPreparedHintState('새로운 목표')});
const data={categories:['검증 분류'],summary:'실제 본문에서 추출한 검증용 설명입니다.',source:'namuwiki',sourceTitle:'새로운 목표',sourceUrl:'https://namu.wiki/w/'+encodeURIComponent('새로운 목표'),sourceLicense:'CC BY-NC-SA 2.0 KR'};
test('자동 힌트는 과반수 이후만 준비하고 저장된 동일 설명을 2단계에서 공개한다',()=>{
 const room=make();room.hint.votes=['a'];reconcilePreparedHint(room,1000);assert.equal(publicHint(room,'a').prepareToken,null);
 room.hint.votes.push('b');reconcilePreparedHint(room,1000);const id=room.hint.requestId;assert.ok(id);assert.equal(publicHint(room,'a').prepareToken,id);
 assert.notEqual(room.hint.readToken,id);assert.equal(publicHint(room,'a').readToken,undefined);
 assert.equal(completeHint(room,'forged',data,1001),false);assert.equal(completeHint(room,id,data,1001),true);
 const first=publicHint(room,'b',1001);assert.deepEqual(first.categories,data.categories);assert.equal(first.summary,'');assert.equal(first.snapshot,undefined);assert.equal(first.prepareToken,null);
 room.hint.votes=['a','b'];assert.equal(reconcilePreparedHint(room,61000),false);assert.equal(reconcilePreparedHint(room,61001),true);
 assert.equal(publicHint(room,'a').summary,data.summary);assert.equal(publicHint(room,'a').level,2);
});
test('설명 또는 분류 하나만 확보해도 빈 2단계를 약속하지 않는다',()=>{
 for(const value of [{...data,summary:''},{...data,categories:[]}]){
  const room=make();room.hint.votes=['a','b'];reconcilePreparedHint(room,1);completeHint(room,room.hint.requestId,value,2);
  assert.equal(room.hint.maxLevel,1);assert.equal(hintVoteInfo(room,'a',100000).canRequest,false);
  const shown=publicHint(room,'a');assert.ok(shown.categories.length || shown.summary);
 }
});
test('미확보·30초 타임아웃·이전 라운드 응답이 투표를 잠그거나 새 방을 오염시키지 않는다',()=>{
 const room=make();room.hint.votes=['a','b'];reconcilePreparedHint(room,1);const id=room.hint.requestId;
 reconcilePreparedHint(room,30001);assert.equal(room.hint.status,'unavailable');assert.equal(completeHint(room,id,data,30002),false);
 assert.equal(hintVoteInfo(room,'a',90001).canRequest,true);
 room.hint=newPreparedHintState('또 다른 목표');assert.equal(completeHint(room,id,data),false);
});
