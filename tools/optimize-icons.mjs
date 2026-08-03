/**
 * アイコンを軽くする。
 *
 * なぜ必要か：
 *   favicon.png が 922KB あった。1024x1024 のフルカラー PNG で、
 *   タブとブックマークに出すためだけの画像としては桁が違う。
 *   このアプリの絵は色数が少ないので、パレット PNG にすれば
 *   見た目を変えずに大きく減らせる。
 *
 *   40人が同時に開く校内 Wi-Fi では、この差がそのまま初回表示の待ち時間になる。
 *
 * maskable アイコンは実測でセーフゾーン外 0.00%（＝正しく作られている）なので、
 * 大きさだけ落として中身には触らない。
 *
 *   npm ci && npm run icons
 */
import sharp from 'sharp';
import { writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 見た目が変わらない範囲で、いちばん軽いパレット PNG を選ぶ */
const palettize = async (src, size) => {
    let best = null;
    for (const colours of [256, 192, 128, 96]) {
        const buf = await sharp(src)
            .resize(size, size)
            .png({ palette: true, colours, effort: 10, compressionLevel: 9 })
            .toBuffer();
        if (!best || buf.length < best.buf.length) best = { buf, colours };
    }
    return best;
};

const targets = [
    // favicon に 1024 は要らない。タブとブックマークで使うだけ。
    ['favicon.png', 256],
    ['icons/icon-512.png', 512],
    ['icons/icon-192.png', 192],
    ['icons/maskable-512.png', 512],
    ['icons/maskable-192.png', 192],
    ['icons/apple-touch-icon.png', 180],
];

let before = 0;
let after = 0;
for (const [rel, size] of targets) {
    const src = join(ROOT, rel);
    if (!existsSync(src)) continue;
    const was = statSync(src).size;
    const { buf, colours } = await palettize(src, size);
    // sharp を通して書き直すとパレットが落ちるので、作ったバッファをそのまま書く
    writeFileSync(src, buf);
    before += was;
    after += buf.length;
    console.log(`${rel}  ${(was / 1024).toFixed(1)} KB → ${(buf.length / 1024).toFixed(1)} KB (${colours}色)`);
}
console.log(`\n合計 ${(before / 1024).toFixed(1)} KB → ${(after / 1024).toFixed(1)} KB`);
