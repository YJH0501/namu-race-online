// Parse only trusted publisher HTML. No model-generated facts or fuzzy title matching.
export type DocumentHint = {
  categories: string[]; summary: string; source: 'namuwiki'; sourceTitle: string;
  sourceUrl: string; sourceLicense: string; sourceLicenseUrl: string;
};
const ORIGIN = 'https://namu.wiki';
export function plainText(value: string, max = 220) {
  const entities: Record<string,string> = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
  const clean = value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, name: string) => {
    if (!name.startsWith('#')) return entities[name] ?? all;
    const n = parseInt(name.slice(name[1] === 'x' ? 2 : 1), name[1] === 'x' ? 16 : 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/<[^>]*>/g,'').replace(/\[(?:\d+|주\s*\d+)\]/g,'')
    .replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim();
  return clean.length > max ? clean.slice(0,max-1).trim() + '…' : clean;
}
function usableExcerpt(text: string) {
  const t = plainText(text, 1800);
  if (t.length < 5 || (t.match(/[가-힣]/g) || []).length < 3 ||
    /파일:|https?:|펼치기|접기|문서가 존재하지|없는 문서|보안 확인|Just a moment|이 저작물|CC BY|나무레이스|공식 웹사이트|플레이하기|편집 권한|IP 우회|IDC 대역|접속하셨|로그인|권한이 부족|차단되어/i.test(t) ||
    /^[\d.,=\s]+$|^["“「『]|^이 문서|^다른 뜻|^목차/.test(t)) return '';
  const sentences = t.match(/.{4,}?[.!?](?=\s|$)/g) || [];
  const first = sentences.find(s=>(s.match(/[가-힣]/g)||[]).length >= 3);
  // A category label or an unfinished metadata fragment is not a definition.
  return first ? plainText(first) : '';
}
export async function extractDocumentHint(html: string, requestedTitle: string): Promise<DocumentHint | null> {
  let title = '', description = '', ignored = 0, section = 0;
  const categories: string[] = [];
  const blocks: {text:string; section:number}[] = [];
  const stack: {text:string; child:boolean; section:number}[] = [];
  const add = (text: string) => { const b = stack.at(-1); if (b && !ignored && b.text.length < 1800) b.text += text.slice(0,1800-b.text.length); };
  const parsed = new HTMLRewriter()
    .on('meta[property="og:title"]', {element(e){title = plainText(e.getAttribute('content') || '',200);}})
    .on('meta[property="og:description"]', {element(e){description=e.getAttribute('content') || '';}})
    .on('table,nav,header,footer,script,style,details,blockquote,figure,figcaption,math,.wiki-toc,.wiki-footnote,.wiki-folding', {
      element(e){ignored++; e.onEndTag(()=>{ignored--;});}
    })
    .on('h2,h3', {element(e){ignored++; e.onEndTag(()=>{ignored--;});}})
    .on('h2 a[id^="s-"],h3 a[id^="s-"]', {element(){section++;}})
    .on('a[href]', {element(e){
      if (ignored || categories.length >= 24) return;
      try {
        const u = new URL(e.getAttribute('href') || '', ORIGIN);
        const t = e.getAttribute('data-namu-title') || (u.origin===ORIGIN && u.pathname.startsWith('/w/') ? decodeURIComponent(u.pathname.slice(3)) : '');
        if (t.startsWith('분류:')) categories.push(plainText(t.slice(3),60));
      } catch { /* Invalid link. */ }
    }})
    .on('div,p,li', {
      element(e) {
        if (stack.length) stack[stack.length-1].child = true;
        const block = {text:'',child:false,section}; stack.push(block);
        e.onEndTag(()=>{
          stack.pop();
          if (!ignored && !block.child && block.section <= 1 && blocks.filter(b=>b.section===block.section).length < (block.section ? 40 : 100) && plainText(block.text,1800).length >= 8) blocks.push({text:block.text,section:block.section});
        });
      }
    })
    .on('br', {element(){add(' ');}})
    .on('sup', {element(e){add('^('); e.onEndTag(()=>add(')'));}})
    .on('sub', {element(e){add('_('); e.onEndTag(()=>add(')'));}})
    .onDocument({text(t){add(t.text);}})
    .transform(new Response(html));
  const reader = parsed.body!.getReader(); while (!(await reader.read()).done) { /* drain */ }
  // Redirects must be resolved separately; never silently label another page as this goal.
  if (!title || title !== plainText(requestedTitle,200)) return null;
  const selected = [...new Set(categories)].filter(c=>c && c!==title && !/^(나무위키|분류:|틀:|문서 관리)/.test(c)).slice(0,3);
  const early = blocks.filter(b=>b.section===1).slice(0,16);
  const candidates = (early.length ? early : blocks.filter(b=>b.section===0).slice(0,25))
    .map(b=>usableExcerpt(b.text)).filter(Boolean);
  const baseTitle = title.replace(/\([^)]*\)$/,'').trim();
  let summary = candidates.slice(0,5).find(s=>s.slice(0,80).includes(baseTitle)) || candidates[0] || '';
  if (!summary && /[.!?]$/.test(description.trim())) summary = usableExcerpt(description);
  if (selected.some(c=>/동음이의/.test(c))) summary = '';
  if (!selected.length && !summary) return null;
  return {categories:selected,summary,source:'namuwiki',sourceTitle:title,sourceUrl:ORIGIN+'/w/'+encodeURIComponent(title),
    sourceLicense:'CC BY-NC-SA 2.0 KR',sourceLicenseUrl:'https://creativecommons.org/licenses/by-nc-sa/2.0/kr/'};
}
