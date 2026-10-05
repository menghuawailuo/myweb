/* 橱柜对账 Service Worker
 * 注意：修改 index.html / css / js 后，请升级 CACHE 版本号（如 cabinet-v4），
 * 否则已安装用户不会刷新缓存（同源资源虽为网络优先，但离线时会用到旧缓存）。
 *
 * 部署前提：Service Worker 只在 https:// 或 localhost 下可用。
 * 直接用 file:// 双击打开 index.html 时不会注册，属于正常现象。 */
const CACHE = 'cabinet-v11';

const CORE = [
  './',
  './index.html',
  './css/style.css',
  './js/calc.js',
  './js/app.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 按需加载的 PDF / Excel 库，也提前缓存，断网时导出仍可用
const CDN = [
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

// 只缓存真正成功的响应。否则一次 404 / 502 会被存进缓存并长期返回给用户。
function putIfOk(request, response) {
  if (!response || !response.ok || response.type === 'opaqueredirect') return response;
  const copy = response.clone();
  caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(
      CORE.concat(CDN).map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))
    )).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 页面导航：网络优先，断网时回退到缓存里的 index.html
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => putIfOk(req, res))
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // CDN 脚本：缓存优先（首次加载后离线可用）
  if (CDN.indexOf(req.url) !== -1 || CDN.some(u => req.url.indexOf(u) === 0)) {
    e.respondWith(
      caches.match(req).then(cached => cached ||
        fetch(req).then(res => putIfOk(req, res))
      )
    );
    return;
  }

  // 同源资源：网络优先，失败回退缓存
  e.respondWith(
    fetch(req)
      .then(res => putIfOk(req, res))
      .catch(() => caches.match(req).then(r => r || Response.error()))
  );
});
