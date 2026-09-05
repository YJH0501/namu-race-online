import test from 'node:test';
import assert from 'node:assert/strict';
import { newHintState, hintVoteInfo, publicHint, reconcileHint, completeHint, selectHintText, cleanHintText, createHintCache } from '../shared/hints.mjs';

const roomFor = (count = 4) => ({ status: 'racing', hint: newHintState(), players: Array.from({ length: count }, (_, i) => ({ id: String(i), finishedAt: null, forfeitedAt: null })) });
const data = { categories: ['컴퓨터 과학'], summary: '목표 문서의 짧은 설명입니다.', sourceUrl: 'https://namu.wiki/w/목표' };

test('과반수, 중복 표 제거, 완료자 제외, 1인 투표', () => {
  const room = roomFor();
  room.hint.votes = ['0', '0', '1'];
  assert.equal(hintVoteInfo(room, '0').required, 3);
  assert.equal(reconcileHint(room), false);
  room.players[3].finishedAt = 1;
  assert.equal(reconcileHint(room), true);
  assert.equal(room.hint.status, 'loading');
  assert.equal(reconcileHint(room), false);
  const solo = roomFor(1); solo.hint.votes = ['0'];
  assert.equal(reconcileHint(solo), true);
});

test('2단계 설명은 공개 전에 절대 보내지 않고 60초 대기한다', () => {
  const room = roomFor(2); room.hint.votes = ['0', '1'];
  assert.equal(publicHint({ ...room, status: 'waiting' }, '0'), null);
  assert.equal(publicHint(room, 'stranger'), null);
  reconcileHint(room, 1000);
  assert.equal(completeHint(room, room.hint.requestId, data, 1100), true);
  assert.equal(publicHint(room, '0').summary, '');
  assert.deepEqual(publicHint(room, '0').categories, data.categories);
  assert.equal(hintVoteInfo(room, '0', 61099).canRequest, false);
  room.hint.votes = ['0', '1'];
  assert.equal(reconcileHint(room, 61100), true);
  completeHint(room, room.hint.requestId, data, 61200);
  assert.equal(publicHint(room, '1').summary, data.summary);
  assert.equal(room.hint.level, 2);
  assert.equal(hintVoteInfo(room, '0', 200000).canRequest, false);
});

test('실패·타임아웃은 재시도 대기, 이전 라운드 응답은 무시', () => {
  const room = roomFor(1); room.hint.votes = ['0']; reconcileHint(room, 1000);
  const oldRequest = room.hint.requestId;
  reconcileHint(room, 16000);
  assert.equal(room.hint.status, 'unavailable');
  assert.equal(completeHint(room, oldRequest, data), false);
  assert.equal(hintVoteInfo(room, '0', 75999).canRequest, false);
  room.hint = newHintState();
  assert.equal(completeHint(room, oldRequest, data), false);
});

test('힌트는 짧은 원문 발췌만 사용하며 관리 분류, 링크, 마크업은 제외한다', () => {
  const result = selectHintText('인공지능', ['인공지능', '나무위키:편집지침', '컴퓨터 과학', '컴퓨터 과학'],
    ['[ 펼치기 · 접기 ]', '인공지능은 인간의 학습 능력과 추론 능력을 컴퓨터로 구현하는 기술이다.[1] 긴 두 번째 문장.']);
  assert.deepEqual(result.categories, ['컴퓨터 과학']);
  assert.equal(result.summary, '인공지능은 인간의 학습 능력과 추론 능력을 컴퓨터로 구현하는 기술이다.');
  assert.equal(selectHintText('없음', [], [], '문서가 존재하지 않습니다. 없는 문서입니다.').summary, '');
  assert.ok(cleanHintText('가'.repeat(500)).length <= 220);
  assert.doesNotMatch(cleanHintText('<a href="x">테스트</a> https://example.com'), /<|https:/);
  assert.equal(cleanHintText('대한민국&#91;42&#93; &amp; 한국'), '대한민국 & 한국');
  assert.equal(selectHintText('책', [], ['1. 개요2. 한국 내 출판과 제목 오역3. 줄거리 및 특징4. 등장인물', '프랑스 작가가 집필한 유명한 장편 과학 소설이다.']).summary, '프랑스 작가가 집필한 유명한 장편 과학 소설이다.');
});

test('임시 저장 개수·수명 제한, 동시 요청 통합, 실패는 1분 후 재시도', async () => {
  let now = 0, calls = 0;
  const cache = createHintCache({ maxEntries: 2, ttlMs: 1000, now: () => now });
  const fetcher = async () => { calls++; return data; };
  await Promise.all([cache.get('a', fetcher), cache.get('a', fetcher)]);
  assert.equal(calls, 1);
  await cache.get('b', fetcher); await cache.get('c', fetcher);
  assert.equal(cache.size, 2);
  await cache.get('a', fetcher); assert.equal(calls, 4);
  now = 1001; await cache.get('a', fetcher); assert.equal(calls, 5);
  const failed = async () => { calls++; throw Error('offline'); };
  await cache.get('failed', failed); await cache.get('failed', failed); assert.equal(calls, 6);
  now += 60000; await cache.get('failed', failed); assert.equal(calls, 7);
});
