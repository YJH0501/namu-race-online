// Remote preview only. No production room bindings and no arbitrary URL proxy.
export default {
  async fetch(request: Request) {
    const title = new URL(request.url).searchParams.get('title') || '';
    if (!['사이토카인', '칼슘', '인도차이나표범', '테크볼', '프리드리히 2세(신성 로마 제국)'].includes(title)) return new Response('Unknown probe', {status:400});
    const began = Date.now();
    const r = await fetch('https://namu-race.yangkun050178.chatgpt.site/api/article?title=' + encodeURIComponent(title), {redirect:'manual', signal:AbortSignal.timeout(8000), headers:{Accept:'text/html','User-Agent':'NamuRaceHintBenchmark/1.0 (https://github.com/YJH0501/namu-race-online)'}});
    const text = (await r.text()).slice(0, 2*1024*1024);
    return Response.json({title, status:r.status, ms:Date.now()-began, length:text.length, pageTitle:text.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || '', error:r.ok ? '' : text.match(/<p>([^<]*)<\/p>/)?.[1] || 'upstream error'});
  }
};
