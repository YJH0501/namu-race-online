import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {RANDOM_TITLE_POOL, RANDOM_CATALOG} from '../shared/random-title-pool.mjs';
import {isCompatibleCatalogTitle} from '../shared/catalog-policy.mjs';
import {pickCatalogRoute} from '../shared/catalog-selection.mjs';
import {newPreparedHintState} from '../shared/prepared-hints.mjs';

test('expanded catalog contains 100,000 unique client-compatible titles with matching provenance hash', () => {
  assert.equal(RANDOM_TITLE_POOL.length,100000);
  assert.equal(new Set(RANDOM_TITLE_POOL).size,100000);
  assert.ok(RANDOM_TITLE_POOL.every(isCompatibleCatalogTitle));
  assert.equal(RANDOM_CATALOG.count,RANDOM_TITLE_POOL.length);
  assert.equal(createHash('sha256').update(JSON.stringify(RANDOM_TITLE_POOL)).digest('hex'),RANDOM_CATALOG.sha256);
});

test('catalog title rules reject administration, normalization changes and invalid paths', () => {
  for(const title of ['',null,' a','a_1','x'.repeat(201),'a\u0000b','분류:컴퓨터','파일:사진.jpg','틀:목차','.','..']) assert.equal(isCompatibleCatalogTitle(title),false,String(title));
  for(const title of ['C++','AC/DC','#','문서(설명)','A:B','빵 & 버터']) assert.equal(isCompatibleCatalogTitle(title),true,title);
});

test('large catalog sampling reaches its tail and does not restrict goals to prepared hint cards', () => {
  let index=RANDOM_TITLE_POOL.length-1;
  const route=pickCatalogRoute(RANDOM_TITLE_POOL,[],[],()=>index--);
  assert.equal(route.goalTitle,RANDOM_TITLE_POOL.at(-1));
  assert.notEqual(route.startTitle,route.goalTitle);
  assert.equal(newPreparedHintState(route.goalTitle).available,true);
});

test('known failed and renamed sample titles are removed, canonical replacements remain', () => {
  const c=JSON.parse(readFileSync(new URL('../server/data/catalog-corrections.json',import.meta.url),'utf8'));
  const pool=new Set(RANDOM_TITLE_POOL);
  for(const title of [...c.exclude,...Object.keys(c.canonicalTitles)]) assert.equal(pool.has(title),false,title);
  for(const title of Object.values(c.canonicalTitles)) assert.equal(pool.has(title),true,title);
});
