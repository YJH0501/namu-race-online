// @ts-expect-error Plain ESM helpers are shared with deterministic Node tests.
import { cleanHintText, createHintCache, selectHintText } from '../../shared/hints.mjs';

const cache = createHintCache();
const ORIGIN = 'https://namu.wiki';
// Reuse the game's existing public reader service: its normal article-fetch path
// works from the deployed web runtime, unlike direct fetches from the room DO.
const READER_ORIGIN = 'https://namu-race.yangkun050178.chatgpt.site';
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function extractHint(html: string, title: string) {
  const categories: string[] = [];
  const paragraphs: string[] = [];
  const active: { text: string; ignored: boolean }[] = [];
  let ignoredDepth = 0;
  let description = '';
  let pageTitle = '';
  let bodyText = '';
  const rewritten = new HTMLRewriter()
    .on('meta[property="og:title"]', { element(el) { pageTitle = el.getAttribute('content') || ''; } })
    .on('meta[property="og:description"]', { element(el) { description = el.getAttribute('content') || ''; } })
    .on('table, nav, header, footer, script, style, .wiki-folding, .wiki-toc, .wiki-footnote', {
      element(el) { ignoredDepth += 1; el.onEndTag(() => { ignoredDepth -= 1; }); },
    })
    .on('a[href]', {
      element(el) {
        if (categories.length >= 24 || ignoredDepth) return;
        try {
          const url = new URL(el.getAttribute('href') || '', ORIGIN);
          const bridgedTitle = el.getAttribute('data-namu-title');
          const name = bridgedTitle || (url.origin === ORIGIN && url.pathname.startsWith('/w/') ? decodeURIComponent(url.pathname.slice(3)) : '');
          if (name.startsWith('분류:')) categories.push(name.slice(3));
        } catch { /* Invalid upstream links are not hints. */ }
      },
    })
    .on('.wiki-paragraph', {
      element(el) {
        const paragraph = { text: '', ignored: ignoredDepth > 0 || paragraphs.length >= 40 };
        active.push(paragraph);
        el.onEndTag(() => { active.pop(); if (!paragraph.ignored) paragraphs.push(paragraph.text); });
      },
      text(chunk) {
        const paragraph = active.at(-1);
        if (paragraph && !paragraph.ignored && !ignoredDepth && paragraph.text.length < 1200) paragraph.text += chunk.text.slice(0, 1200 - paragraph.text.length);
      },
    })
    .on('br', { element() { const paragraph = active.at(-1); if (paragraph && !paragraph.ignored) paragraph.text += ' '; if (!ignoredDepth) bodyText += ' '; } })
    .onDocument({ text(chunk) { if (!ignoredDepth && bodyText.length < 120000) bodyText += chunk.text.slice(0, 120000 - bodyText.length); } })
    .transform(new Response(html));
  // Drain without retaining a second copy of the document.
  const reader = rewritten.body!.getReader();
  while (!(await reader.read()).done) { /* parse */ }
  if (!pageTitle || /문서가 존재하지|없는 문서|Just a moment/i.test(pageTitle)) { console.warn('NAMU_HINT no article metadata'); return null; }
  // Some responses use opaque CSS class names. Locate the real lead paragraph
  // by its publisher-provided description prefix instead of depending on classes.
  const lead = cleanHintText(description, 100).replace(/\s/g, '').slice(0, 24);
  if (lead.length >= 10) {
    const text = cleanHintText(bodyText, 120000);
    const pattern = [...lead].map((char) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    const match = new RegExp(pattern, 'u').exec(text);
    if (match) paragraphs.unshift(text.slice(match.index, match.index + 600));
  }
  const data = selectHintText(title, categories, paragraphs, description);
  return data.categories.length || data.summary ? { ...data, sourceUrl: `${ORIGIN}/w/${encodeURIComponent(title)}` } : null;
}

async function fetchHint(title: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    let url = new URL(`/api/article?title=${encodeURIComponent(title)}`, READER_ORIGIN);
    let response: Response | undefined;
    let retried = false;
    for (let redirect = 0; redirect < 4; redirect += 1) {
      response = await fetch(url.href, { redirect: 'manual', signal: controller.signal, headers: {
        Accept: 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; NamuRace/1.0; +https://namu-race.yangkun050178.chatgpt.site)',
      } });
      if (!retried && [502, 503, 504].includes(response.status)) {
        retried = true;
        await response.body?.cancel();
        continue;
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      url = new URL(location, url);
      if (url.origin !== READER_ORIGIN || url.pathname !== '/api/article') return null;
    }
    if (!response?.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) {
      console.warn('NAMU_HINT upstream status', response?.status);
      await response?.body?.cancel(); return null;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    let bytes = 0;
    while (bytes < MAX_HTML_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const part = value.subarray(0, MAX_HTML_BYTES - bytes);
      bytes += part.byteLength;
      html += decoder.decode(part, { stream: true });
    }
    await reader.cancel();
    html += decoder.decode();
    return await extractHint(html, title);
  } catch (error) {
    console.warn('NAMU_HINT fetch failed', error instanceof Error ? error.message : 'unknown error');
    return null;
  } finally { clearTimeout(timer); }
}

export function getGoalHint(title: string) {
  return cache.get(title, fetchHint);
}
