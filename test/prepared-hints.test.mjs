import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { getHintCard, HINT_GOAL_TITLES } from '../shared/hint-catalog.mjs';
import { RANDOM_TITLE_POOL } from '../shared/random-title-pool.mjs';
import { dailyRoute } from '../shared/routes.mjs';
import { newHintState, publicHint, hintVoteInfo } from '../shared/hints.mjs';
import { newPreparedHintState, prepareRoomHint, reconcilePreparedHint } from '../shared/prepared-hints.mjs';

const roomFor = (goalTitle = '인공지능') => ({ status: 'racing', goalTitle,
  hint: newPreparedHintState(goalTitle), players: [{ id: 'a' }, { id: 'b' }] });

test('모든 준비된 카드는 검토 표시·출처·설명·서로 다른 연관 개념을 갖는다', () => {
  assert.ok(HINT_GOAL_TITLES.length >= 50);
  assert.equal(new Set(HINT_GOAL_TITLES).size, HINT_GOAL_TITLES.length);
  const known = new Set(RANDOM_TITLE_POOL);
  for (const title of HINT_GOAL_TITLES) {
    const c = getHintCard(title);
    assert.ok(known.has(title)); assert.equal(c.reviewed, true, title);
    assert.ok(c.summary.length >= 15 && c.summary.length <= 220, title);
    assert.doesNotMatch(c.summary, /[<>\uFFFD]|https?:|소금덩어리|옳고 그름이 누구/);
    assert.ok(c.relatedTitles.length >= 2 && c.relatedTitles.length <= 3);
    assert.equal(new Set(c.relatedTitles).size, c.relatedTitles.length);
    assert.ok(c.relatedTitles.every(t => known.has(t) && t !== title));
    assert.equal(new URL(c.sourceUrl).origin, 'https://ko.wikipedia.org');
    assert.equal(c.sourceLicense, 'CC BY-SA 4.0');
    assert.ok(Number.isSafeInteger(c.sourceRevision));
  }
});

test('과반수 즉시 설명 공개, 60초 후 연관 개념 공개, 비공개 카드 전송 금지', () => {
  const room = roomFor();
  room.hint.votes = ['a', 'a'];
  assert.equal(reconcilePreparedHint(room, 1000), false);
  const hidden = publicHint(room, 'a', 1000);
  assert.equal(hidden.summary, ''); assert.equal(hidden.sourceUrl, '');
  assert.deepEqual(hidden.relatedTitles, []); assert.equal(hidden.card, undefined);
  room.hint.votes.push('b');
  assert.equal(reconcilePreparedHint(room, 1000), true);
  assert.equal(publicHint(room, 'a').summary, getHintCard(room.goalTitle).summary);
  assert.deepEqual(publicHint(room, 'b').relatedTitles, []);
  assert.equal(reconcilePreparedHint(room, 1000), false);
  room.hint.votes = ['a', 'b'];
  assert.equal(reconcilePreparedHint(room, 60999), false);
  assert.equal(reconcilePreparedHint(room, 61000), true);
  assert.deepEqual(publicHint(room, 'a').relatedTitles, getHintCard(room.goalTitle).relatedTitles);
  assert.equal(publicHint(room, 'stranger'), null);
  assert.equal(publicHint({ ...room, status: 'waiting' }, 'a'), null);
});

test('진행 중 이탈에 따른 과반수 재계산과 완료자 제외', () => {
  const room = roomFor(); room.players.push({ id: 'c' }, { id: 'd' });
  room.hint.votes = ['a', 'b', 'intruder'];
  assert.equal(reconcilePreparedHint(room, 1), false);
  room.players.pop();
  assert.equal(reconcilePreparedHint(room, 2), true);
  room.players[0].finishedAt = 1;
  assert.equal(hintVoteInfo(room, 'a', 70000).eligible, false);
});

test('지원하지 않는 직접 지정 목표는 재시도 없이 힌트 미지원', () => {
  const room = roomFor('카드 없는 문서');
  room.hint.votes = ['a', 'b'];
  assert.equal(hintVoteInfo(room, 'a', 99999999).canRequest, false);
  assert.equal(reconcilePreparedHint(room), false);
  assert.equal(publicHint(room, 'a').available, false);
});

test('기존 방의 공개된 설명과 서버 저장 스냅샷은 배포 후에도 유지된다', () => {
  const room = roomFor();
  room.hint = { ...newHintState(), level: 1, categories: ['기존 분류'],
    summary: '기존 방에 이미 저장된 짧은 설명입니다.', revealedAt: 1, status: 'loading', requestId: 'old' };
  assert.equal(prepareRoomHint(room), true);
  assert.equal(room.hint.format, 'legacy');
  assert.equal(publicHint(room, 'a').summary, '');
  room.hint.votes = ['a', 'b'];
  reconcilePreparedHint(room, 60001);
  assert.equal(publicHint(room, 'a').summary, '기존 방에 이미 저장된 짧은 설명입니다.');
  const fresh = roomFor();
  fresh.hint.card.summary = '라운드 시작 전에 저장된 검증용 스냅샷입니다.';
  const restored = JSON.parse(JSON.stringify(fresh));
  assert.equal(prepareRoomHint(restored), false);
  restored.hint.votes = ['a', 'b']; reconcilePreparedHint(restored);
  assert.equal(publicHint(restored, 'b').summary, fresh.hint.card.summary);
  assert.notEqual(getHintCard(fresh.goalTitle).summary, fresh.hint.card.summary);
});

test('실패했던 기존 0단계 방은 지원 카드로 전환하고, 설명 없는 기존 1단계는 투표를 막는다', () => {
  const room = roomFor(); room.hint = { ...newHintState(), status: 'unavailable', retryAt: 999999 };
  prepareRoomHint(room); assert.equal(room.hint.format, 'card-v1');
  assert.equal(hintVoteInfo(room, 'a', 1).canRequest, true);
  room.hint = { ...newHintState(), level: 1, categories: ['기존 분류'] };
  prepareRoomHint(room); assert.equal(hintVoteInfo(room, 'a').canRequest, false);
  assert.deepEqual(publicHint(room, 'b').categories, ['기존 분류']);
});

test('일일 목표도 힌트 지원 목록에서 결정하고 같은 날짜는 같은 경로다', () => {
  for (let day = 1; day <= 365; day++) {
    const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
    const route = dailyRoute(date);
    assert.ok(getHintCard(route.goalTitle)); assert.notEqual(route.startTitle, route.goalTitle);
    assert.deepEqual(route, dailyRoute(date));
  }
});

test('운영 서버 번들에는 실시간 힌트 조회 코드가 들어가지 않는다', async () => {
  const result = await build({ entryPoints: ['server/src/index-final-v2.ts'], bundle: true,
    metafile: true, write: false, format: 'esm', external: ['cloudflare:workers'] });
  assert.ok(!Object.keys(result.metafile.inputs).some(p => /hint-source|wikipedia-hints|prepare-hint-cards/.test(p)));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(!pkg.build.files.some(p => /^(shared|server)\//.test(p)), 'Card data is not packaged in installers');
});
