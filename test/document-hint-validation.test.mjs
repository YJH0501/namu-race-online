import test from 'node:test';
import assert from 'node:assert/strict';
import { validDocumentHint } from '../shared/document-hint-validation.mjs';
const goal = '옛 문서', title = '현재 문서';
const hint = { source: 'namuwiki', sourceTitle: title, sourceUrl: 'https://namu.wiki/w/' + encodeURIComponent(title),
  categories: ['과학'], summary: '현재 문서는 검증용 문서입니다.', requestedTitle: goal, redirectChain: [goal, title] };
test('verified redirects describe the original goal without relaxing exact-title or source validation', () => {
  assert.equal(validDocumentHint(hint, goal), true);
  assert.equal(validDocumentHint({ ...hint, sourceTitle: goal, sourceUrl: 'https://namu.wiki/w/' + encodeURIComponent(goal) }, goal), true);
  for (const patch of [
    { requestedTitle: '다른 목표' }, { redirectChain: undefined }, { redirectChain: [title] },
    { redirectChain: [goal, '다른 문서'] }, { redirectChain: [goal, title, goal, title] },
    { sourceUrl: 'https://example.com/' }, { source: 'client' }, { summary: 'x'.repeat(221) },
  ]) assert.equal(validDocumentHint({ ...hint, ...patch }, goal), false);
});
