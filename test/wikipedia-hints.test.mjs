import test from 'node:test';
import assert from 'node:assert/strict';
import { comparableWikiTitle, isExactWikipediaArticle, wikipediaHintFromResponses } from '../shared/wikipedia-hints.mjs';
import { newHintState, reconcileHint, completeHint, publicHint } from '../shared/hints.mjs';

const page = { type: 'standard', namespace: { id: 0 }, pageid: 123, title: '고양이',
  extract: '고양이는 식육목 고양이과에 속하는 포유류이며 사람과 함께 살아가는 동물이다.[*] 다른 문장.', description: '포유류' };
const categoryPage = { pageid: 123, ns: 0, title: '고양이', pageprops: {}, categories: [
  { title: '분류:고양이' }, { title: '분류:위키백과 정비' }, { title: '분류:포유류' },
  { title: '분류:숨김 분류', hidden: true }, { title: '분류:반려동물' },
] };

test('위키백과는 정확한 제목과 일반 문서만 허용하며 괄호 내용은 보존한다', () => {
  assert.equal(isExactWikipediaArticle('고양이', page), true);
  assert.equal(comparableWikiTitle('영화_제목 (영화)'), '영화 제목(영화)');
  for (const title of ['고양이(게임)', '고양이/역사', '고양', '고 양이', '고양이\u200b']) {
    assert.equal(isExactWikipediaArticle(title, page), false, title);
  }
  assert.equal(isExactWikipediaArticle('고양이', { ...page, title: '개' }), false);
  assert.equal(isExactWikipediaArticle('고양이', { ...page, type: 'disambiguation' }), false);
  assert.equal(isExactWikipediaArticle('고양이', { ...page, namespace: { id: 14 } }), false);
  assert.equal(isExactWikipediaArticle('고양이', { ...page, description: '동음이의 문서' }), false);
});

test('공식 분류와 발췌문에 실제 위키백과 출처·라이선스를 붙인다', () => {
  const data = wikipediaHintFromResponses('고양이', page, categoryPage);
  assert.deepEqual(data.categories, ['포유류', '반려동물']);
  assert.ok(data.summary.length <= 220);
  assert.doesNotMatch(data.summary, /\[\*\]|다른 문장/);
  assert.equal(data.source, 'wikipedia');
  assert.equal(data.sourceLicense, 'CC BY-SA 4.0');
  assert.match(data.sourceUrl, /^https:\/\/ko\.wikipedia\.org\/wiki\//);
  for (const other of [{ ...categoryPage, pageid: 124 }, { ...categoryPage, title: '개' },
    { ...categoryPage, pageprops: { disambiguation: '' } }, { ...categoryPage, missing: true }]) {
    assert.equal(wikipediaHintFromResponses('고양이', page, other), null);
  }
  assert.equal(wikipediaHintFromResponses('고양이', { ...page, extract: '' }, categoryPage), null);
});

test('출처 정보도 대기실에서 숨기고, 1단계 후 보관한 설명과 출처를 2단계에서 함께 공개한다', () => {
  const data = wikipediaHintFromResponses('고양이', page, categoryPage);
  const room = { status: 'racing', goalTitle: '고양이', players: [{ id: 'me' }], hint: newHintState() };
  assert.equal(publicHint(room, 'me').sourceUrl, '');
  room.hint.votes = ['me']; reconcileHint(room, 1000);
  completeHint(room, room.hint.requestId, data, 1001);
  const persisted = JSON.parse(JSON.stringify(room));
  assert.equal(publicHint(persisted, 'me').summary, '');
  assert.equal(publicHint(persisted, 'me').source, 'wikipedia');
  assert.equal(publicHint({ ...persisted, status: 'waiting' }, 'me'), null);
  persisted.hint.votes = ['me']; reconcileHint(persisted, 61002);
  completeHint(persisted, persisted.hint.requestId, { ...persisted.hint }, 61003);
  assert.equal(publicHint(persisted, 'me').summary, data.summary);
  assert.equal(publicHint(persisted, 'me').sourceUrl, data.sourceUrl);
  assert.equal(publicHint(persisted, 'me').sourceLicense, data.sourceLicense);
});
