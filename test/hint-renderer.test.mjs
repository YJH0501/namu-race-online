import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const renderer = readFileSync('src/renderer-online.js', 'utf8');
const functions = renderer.slice(renderer.indexOf('function hintAvailabilityHtml('), renderer.indexOf('function mountHintPanel('));
function render(hint) {
  const context = { state: { room: { hint, goalTitle: '목표' } }, escapeHtml: s => String(s).replaceAll('<', '&lt;') };
  vm.createContext(context);
  return vm.runInContext(functions + '\nhintPanelHtml()', context);
}
test('프로그램은 1단계 설명, 2단계 연관 개념을 읽기 전용 텍스트로 표시한다', () => {
  const hint = { format: 'card-v1', available: true, level: 1, status: 'ready', eligible: true, nextAvailableAt: 0,
    categories: [], summary: '검토한 설명', relatedTitles: [], source: 'wikipedia', sourceLicense: 'CC BY-SA 4.0' };
  const first = render(hint);
  assert.match(first, /1단계 · 어떤 대상인가요/); assert.match(first, /검토한 설명/);
  assert.doesNotMatch(first, /2단계 · 연관 개념|추출하지 못|보조 힌트|<a /);
  const second = render({ ...hint, level: 2, relatedTitles: ['개념 하나', '<img onerror=test>'] });
  assert.match(second, /개념 하나 · &lt;img/);
  assert.doesNotMatch(second, /<img|data-action="hint-vote"/);
  assert.match(second, /최단 경로를 보장하지 않아요/);
  assert.match(second, /위키백과 기여자 · CC BY-SA 4.0/);
});
test('카드 미지원은 투표 버튼을 숨기고 기존 방은 분류·설명을 보존한다', () => {
  assert.doesNotMatch(render({ available: false, level: 0, eligible: true }), /data-action="hint-vote"/);
  assert.match(render({ available: false, level: 0 }), /힌트 없이 진행/);
  assert.match(render({ format: 'legacy', available: true, level: 2, categories: ['기존 분류'], summary: '기존 설명' }), /기존 분류/);
});
