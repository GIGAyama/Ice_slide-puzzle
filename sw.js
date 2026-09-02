/**
 * 南極スライダー Service Worker
 * - アプリシェルは事前キャッシュ（オフラインでも起動可能）
 * - CDNリソース（フォント・SweetAlert2）は stale-while-revalidate
 */
/*
 * 【最重要】activate では自アプリ以外のキャッシュを削除しない。
 *   旧配信元の gigayama.github.io は数十個のアプリが同一オリジンを共有していた。
 *   同居する配置に戻したときに他アプリを巻き込まないよう、
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する。
 *   以前はここで caches.keys() の結果を全部消していた。そのため
 *   このアプリを開くたびに、同じ端末に入っている他の GIGA アプリの
 *   キャッシュまで巻き添えで消え、それらがオフラインで起動しなくなっていた。
 */
const CACHE_PREFIX = 'nankyoku-';
// CACHE_VERSION は手で上げない。node tools/build-sw.mjs が先読み対象の中身から自動で決める
const CACHE_VERSION = 'va083c0b6'; /* __APP_VERSION__ */
const PRECACHE = `${CACHE_PREFIX}precache-${CACHE_VERSION}`;
const RUNTIME = `${CACHE_PREFIX}runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  // 書体そのもの（woff2）は先読みに入れない。入れると先読みが 1MB を超え、
  // 校内 Wi-Fi で 40 台が同時に開いたときに初回表示が止まる。
  // 画面が出れば必ず取りにいくので、その 1 回で下の実行時キャッシュに入る。
  './fonts.css',
  './',
  './index.html',
  // 利用規約・プライバシーの行き先を出す部品。並べておかないと、圏外で開いた
  // ときだけリンクが 1 本も出ない（行き先そのものは開けなくても、どこにあるかは
  // 見えているほうがいい）。
  './web/giga-app-links.js',
  './manifest.webmanifest',
  './offline.html',
  './favicon.png',
  './vendor/sweetalert2.all.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // addAll は1本でも取れないと全部落ちる。校内 Wi-Fi が混んでいるときに
    // 「1つ取りこぼしたせいでオフライン対応が丸ごと入らない」のを避けるため、
    // 個別に入れて、取れなかったものだけ飛ばす。
    await Promise.all(PRECACHE_URLS.map((u) =>
      cache.add(new Request(u, { cache: 'reload' }))
        .catch((err) => console.warn('[sw] precache skipped', u, err))));
    // ここでは skipWaiting しない。
    // 対戦の途中で画面が突然入れ替わると、そこまでの盤面が消える。
    // 画面側で「さいしんに する」を押してもらってから切り替える（下の message）。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          // ← 自アプリ接頭辞のものだけを削除する。ここを外すと
          //    同一オリジンの他アプリを巻き添えにする。
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== PRECACHE && key !== RUNTIME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // ページ遷移: ネットワーク優先、失敗時はキャッシュ済みシェルへ
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PRECACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        // キャッシュにも無ければ offline.html を返す。ここで何も返さないと
        // 児童には「アプリが壊れた」ようにしか見えない。
        .catch(async () => (await caches.match('./index.html'))
          || (await caches.match('./offline.html'))
          || Response.error())
    );
    return;
  }

  const url = new URL(request.url);

  // 同一オリジンの静的ファイル: キャッシュ優先
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // CDN (フォント・SweetAlert2): stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok || response.type === 'opaque') {
            const copy = response.clone();
            caches.open(RUNTIME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});

// 画面側で「さいしんに する」が押されたときだけ切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
