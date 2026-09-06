import { cleanHintText, selectHintText } from './hints.mjs';

// Normalize typography only. Never remove a disambiguating suffix, subpage,
// punctuation, or word spacing to manufacture an identity match.
export function comparableWikiTitle(value) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/_/g, ' ')
    .replace(/\s+/g, ' ').replace(/\s*\(/g, '(').trim() : '';
}

export function isExactWikipediaArticle(title, page) {
  const expected = comparableWikiTitle(title);
  return Boolean(expected && expected.length <= 200 && !/[\p{Cc}\p{Cf}]/u.test(title)
    && page?.type === 'standard' && page?.namespace?.id === 0
    && Number.isSafeInteger(page.pageid) && page.pageid > 0
    && comparableWikiTitle(page.title) === expected
    && !/\(동음이의\)$|^(분류|틀|사용자|위키백과|파일|특수|토론):/.test(expected)
    && !/동음이의|다음 뜻|다음을 가리/.test(String(page.description || '')));
}

export function wikipediaHintFromResponses(title, page, categoryPage) {
  if (!isExactWikipediaArticle(title, page) || !categoryPage || categoryPage.ns !== 0
    || categoryPage.pageid !== page.pageid || categoryPage.missing !== undefined
    || comparableWikiTitle(categoryPage.title) !== comparableWikiTitle(page.title)
    || Object.hasOwn(categoryPage.pageprops || {}, 'disambiguation')) return null;
  const categories = (Array.isArray(categoryPage.categories) ? categoryPage.categories : [])
    .filter((entry) => typeof entry?.title === 'string' && entry.title.startsWith('분류:') && entry.hidden === undefined)
    .map((entry) => entry.title.slice(3))
    .filter((text) => !/위키백과|동음이의|위키데이터|문서|CS1|출처|정비|추적/.test(text));
  // Use the published introduction, not generated text or a Wikidata description.
  const lead = cleanHintText(page.extract, 1200).replace(/\[\*\]/g, '').trim();
  if (lead.length < 25 || /동음이의|다음 뜻|다음을 가리/.test(lead)) return null;
  const selected = selectHintText(title, categories, [lead]);
  if (!selected.summary) return null;
  const sourceTitle = page.title.normalize('NFC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  return { ...selected, source: 'wikipedia', sourceTitle,
    sourceUrl: `https://ko.wikipedia.org/wiki/${encodeURIComponent(sourceTitle.replace(/ /g, '_'))}`,
    sourceLicense: 'CC BY-SA 4.0', sourceLicenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' };
}
