/* ビルド成果物を、GitHub Pages と同じサブパスの下で配る静的サーバ。
 *
 *   node serve.mjs <ルート> <ポート> <ベースパス>
 *   node serve.mjs dist 4180 /Qalc/
 *
 * 本番が https://<user>.github.io/<repo>/ で配信されるアプリは、
 * manifest や Service Worker が /<repo>/ という絶対パスを持っている。
 * ルート直下（http://localhost:4180/）で配ると、そこだけ本番と挙動が変わって
 * 撮影した画面が本物と食いちがう。だからサブパスごと再現する。
 *
 * 外部への口はいっさい開けない。校内フィルタリングの下と同じ状態で撮るため。
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || 'dist');
const PORT = Number(process.argv[3] || 4180);
let BASE = process.argv[4] || '/';
if (!BASE.startsWith('/')) BASE = `/${BASE}`;
if (!BASE.endsWith('/')) BASE = `${BASE}/`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (BASE !== '/' && !p.startsWith(BASE)) {
    if (`${p}/` === BASE) { res.writeHead(302, { Location: BASE }); return res.end(); }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('outside base path');
  }
  let rel = p.slice(BASE.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
});

// 0.0.0.0 ではなく明示的に全インタフェース。IPv6 が使えない環境があるので listen は v4 で。
server.listen(PORT, '0.0.0.0', () => {
  console.log(`serving ${ROOT} at http://127.0.0.1:${PORT}${BASE}`);
});
