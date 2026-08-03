/*
 * 「ホーム画面に追加」の案内を出せるようにするための、ごく小さな仕掛け。
 *
 * Chrome は条件がそろうと beforeinstallprompt を一度だけ投げてくる。
 * これは React が起動するより前に飛んでくることがあり、そのときに
 * 受け取り手がいないとイベントは捨てられ、二度と来ない。
 * 結果として「インストール」ボタンを押しても何も起きなくなる。
 *
 * そのため <head> のいちばん上でこのファイルを同期読み込みし、
 * イベントを window に取っておく。React 側は起動後にこれを拾う。
 *
 * インライン <script> にすると CSP に 'unsafe-inline' か
 * ハッシュが要るので、あえて別ファイルにして script-src 'self' で通す。
 */
(function () {
  window.__pwaInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    window.__pwaInstallPrompt = event;
    window.dispatchEvent(new Event('pwa-install-available'));
  });
  window.addEventListener('appinstalled', function () {
    window.__pwaInstallPrompt = null;
    window.dispatchEvent(new Event('pwa-installed'));
  });
})();
