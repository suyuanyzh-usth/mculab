/*
 * sw.js — Service Worker：让平台在弱网/断网下仍可继续工作
 * ==================================================================
 * 策略选择：**网络优先 + 缓存兜底**（network-first），而不是常见的
 * "缓存优先"。原因很直接——教师需要随时迭代升级平台，如果缓存优先，
 * 学生手里会一直跑旧版本。网络优先保证：只要能连上，拿到的永远是最新版；
 * 连不上时才回退到上一次成功加载的副本。
 *
 * 缓存内容：
 *   · 安装时预缓存应用外壳（首屏必需）；
 *   · 运行期把访问过的同源静态资源顺手缓存（模块、CSS、图片、hex）。
 *
 * 不缓存：
 *   · /api/*（编译、统计、登录必须实时）；
 *   · 非 GET 请求。
 */
const VERSION = 'mculab-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/app.css',
  '/vendor/codemirror/codemirror.js',
  '/vendor/codemirror/codemirror.css',
  '/vendor/mode/clike.js',
  '/js/app.js',
  '/icons/icon-192.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 单个失败不阻断安装（例如某个可选资源缺失）
    await Promise.all(SHELL.map(u => cache.add(u).catch(() => { })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // 跨域不接管
  if (url.pathname.startsWith('/api/')) return;         // 接口永远走网络

  e.respondWith(networkFirst(req, url));
});

async function networkFirst(req, url) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    // 只缓存成功的完整响应
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch(() => { });
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    // 导航请求离线时回退到外壳
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html');
      if (shell) return shell;
    }
    return new Response(
      '离线状态下无法访问该资源。\n\n如果你还没成功打开过平台，请先联网访问一次；\n已经打开过的页面在断网后仍可继续使用。',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}
