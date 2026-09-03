import test from 'node:test';
import assert from 'node:assert/strict';
import { koreaDateKey } from '../shared/korea-date.mjs';

test('오늘의 레이스는 한국 시간 자정에 바뀐다', () => {
  assert.equal(koreaDateKey(new Date('2026-09-02T14:59:59Z')), '2026-09-02');
  assert.equal(koreaDateKey(new Date('2026-09-02T15:00:00Z')), '2026-09-03');
});
