/**
 * 边缘函数：多源站反向代理 + 缓存
 * 触发路径：/*
 */
const ORIGIN_MAP = {
  '/emoticons': 'https://emoticons-cloudflare.hzchu.top',
  '/shenlong':  'http://webapi.shenlongip.com',   // 新加的
  '/api':       'https://another.example.com',    // 以后继续加
};

const CACHE_TTL = 2592000; // 30 天

export async function onRequestGet(event) {
  const { request } = event;
  const urlInfo = new URL(request.url);

  /* 1. 找匹配的上游 */
  const prefix = Object.keys(ORIGIN_MAP).find(p => urlInfo.pathname.startsWith(p));
  if (!prefix) {
    return new Response('404 Not Found', { status: 404 });
  }
  const originBase = ORIGIN_MAP[prefix];

  /* 2. 构造真正的源站 URL */
  const originUrl = originBase + urlInfo.pathname.replace(prefix, '') + urlInfo.search;
  const cacheKey = new Request(originUrl);

  /* 3. 打开缓存 */
  const cache = await caches.open('multi-origin');

  /* 4. 手动刷新缓存（可选） */
  if (urlInfo.searchParams.get('delete')) {
    await cache.delete(cacheKey);
    return new Response('删除成功', { status: 200 });
  }

  /* 5. 读缓存 */
  const cached = await cache.match(cacheKey);
  if (cached) {
    cached.headers.append('x-edgefunctions-cache', 'HIT');
    return cached;
  }

  /* 6. 回源 */
  const response = await fetch(originUrl, {
    headers: {
      Host: new URL(originBase).host, // 把 Host 改成源站域名
    },
  });

  /* 7. 只缓存 200 且可缓存资源 */
  const contentType = response.headers.get('content-type') || '';
  const newHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST',
    'Access-Control-Max-Age': '2592000',
    'Cache-Control': `public,max-age=${CACHE_TTL},immutable`,
    'content-type': contentType,
  };

  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });

  if (response.status === 200) {
    await cache.put(cacheKey, newResponse.clone());
  }
  newResponse.headers.append('x-edgefunctions-cache', 'MISS');
  return newResponse;
}
