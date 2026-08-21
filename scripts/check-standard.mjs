#!/usr/bin/env node
/**
 * 【正本】standards/lib/run-giga-checks.mjs — 正本ゲートの共通ランナー
 * 各リポジトリへは scripts/check-standard.mjs としてコピーする（中身は変えない）。
 *
 *   node scripts/check-standard.mjs
 *
 * 同じディレクトリ構成を前提にする:
 *   scripts/check-standard.mjs      … このファイル（コピー）
 *   scripts/lib/giga-v5-checks.mjs  … 正本ゲート（コピー）
 *   quality.config.json             … リポジトリ固有の値（無ければ既定値で走る）
 *
 * リポジトリ独自の検査・テストは従来どおり各自の check-project 等で走らせ、
 * package.json の check で `node scripts/check-standard.mjs && …` と連ねる。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGigaChecks } from './lib/giga-v5-checks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfgPath = join(ROOT, 'quality.config.json');
const all = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
// 既存の quality.config.json はリポジトリ独自のゲートも読む。キー名の衝突を
// 避けるため、正本ゲートの設定は "standard" キーの下に置く（無ければ全体を使う）
const config = all.standard ?? all;

const results = runGigaChecks(ROOT, config);
let failed = 0;
console.log('=== GIGA Standard v5 — 共通の検査（正本: GIGAyama.github.io/standards/lib/） ===');
for (const r of results) {
  const mark = r.skipped ? '－' : r.ok ? '✅' : '❌';
  console.log(`${mark} ${r.id.padEnd(30)} ${r.title}`);
  if (!r.ok) { failed++; for (const d of r.detail) console.log('     ↳ ' + d); }
}
if (failed === 0) {
  console.log(`共通の検査 ${results.length} 件、すべて通りました。`);
  process.exit(0);
}
console.log(`${failed} 件落ちました。各検査の意味は scripts/lib/giga-v5-checks.mjs の説明を見てください。`);
process.exit(1);
