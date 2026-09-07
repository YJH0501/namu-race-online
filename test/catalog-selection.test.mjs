import test from 'node:test';
import assert from 'node:assert/strict';
import {pickCatalogTitle, pickCatalogRoute, uniformIndex} from '../shared/catalog-selection.mjs';

test('catalog sampler excludes both recent room and server titles', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];
  let i = 0;
  assert.deepEqual(pickCatalogRoute(pool, ['a'], ['b'], n => i++ % n), {goalTitle:'c',startTitle:'d'});
});

test('crowded catalog fallback terminates without repeating the start and goal', () => {
  assert.equal(pickCatalogTitle(['a', 'b'], new Set(['a', 'b']), () => 0), null);
  assert.equal(pickCatalogTitle(['a', 'b'], new Set(['a']), () => 0), 'b');
  const route = pickCatalogRoute(['a', 'b'], ['a', 'b'], ['a', 'b'], () => 0);
  assert.notEqual(route.startTitle, route.goalTitle);
  assert.throws(() => pickCatalogRoute(['a'], [], [], () => 0), /두 개/);
  assert.throws(() => pickCatalogRoute([], [], [], () => 0), /비어/);
});

test('100,000-title normal draw reads only selected entries, including the last title', () => {
  let reads = 0;
  const pool = new Proxy({length:100000}, {get: (t, p) => p === 'length' ? t.length : (reads++, '문서'+p)});
  let next = 99999;
  const result = pickCatalogRoute(pool, [], [], () => next--);
  assert.deepEqual(result, {goalTitle:'문서99999',startTitle:'문서99998'});
  assert.equal(reads, 2);
});

test('uniform indices are bounded, with invalid sizes rejected', () => {
  for (let i = 0; i < 1000; i++) assert.ok(uniformIndex(100000) < 100000);
  assert.equal(uniformIndex(1), 0);
  assert.throws(() => uniformIndex(0), RangeError);
});
