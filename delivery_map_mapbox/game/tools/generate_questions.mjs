#!/usr/bin/env node
// 配達員検定の出題データ生成スクリプト(開発者がローカルで手動実行する)
//
// Geolonia Japanese Addresses v2 の住居表示データから、RYS商圏の町丁目の
// 住所+代表点座標を抽出し、game/questions.json を生成する。
// 生成結果をコミットすると、ゲームは実行時のAPI取得を行わず
// この静的データを使う(デイリーチャレンジが完全に決定的になる)。
//
// 使い方:
//   node delivery_map_mapbox/game/tools/generate_questions.mjs
//
// 出力: delivery_map_mapbox/game/questions.json
//
// 運用ルール: 過去日のデイリー問題を変えないため、データを更新したら
// version を必ず上げること(共有テキストに version が含まれる)。

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const VERSION = 1;

const ADDR_API_BASE = 'https://japanese-addresses-v2.geoloniamaps.com/api/ja';
const ADDR_PREF = '東京都';
const ADDR_CITY = '中央区';

// RYS商圏(小舟町店・浜町店の周辺)。machiaza名がこのいずれかで始まるものを採用
const TARGET_OAZA = [
  '日本橋小舟町',
  '日本橋小網町',
  '日本橋人形町',
  '日本橋堀留町',
  '日本橋富沢町',
  '日本橋久松町',
  '日本橋浜町',
  '日本橋蛎殻町',
  '日本橋大伝馬町',
  '日本橋小伝馬町',
  '日本橋横山町',
  '日本橋中洲',
  '東日本橋',
];

// 1町丁目あたりの最大採用件数(JSONサイズ抑制。シード固定で再現可能に抽出)
const MAX_PER_MACHIAZA = 40;
// 外れ値除去: 小舟町中心からこの距離(m)を超える点は捨てる
const CENTER = { lng: 139.778364, lat: 35.686672 };
const MAX_DIST_FROM_CENTER_M = 2500;
// 出発点(RYS小舟町店)として解決する住所
const START_MACHIAZA = '日本橋小舟町';
const START_LABEL = '8-6';

function distanceMeters(a, b) {
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// 再現可能な抽出のためのシード付きPRNG
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// index.html の parseAddrSection と同じCSVパース
function parseAddrSection(text, machiazaName, out) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 3) return;
  const cols = lines[1].split(',').map(s => s.trim());
  const idx = n => cols.indexOf(n);
  const iBlk = idx('blk_num');
  const iRsdt = idx('rsdt_num');
  const iRsdt2 = idx('rsdt_num2');
  const iLng = idx('lng');
  const iLat = idx('lat');
  if (iBlk < 0 || iLng < 0 || iLat < 0) return;
  for (let i = 2; i < lines.length; i++) {
    const v = lines[i].split(',');
    const n1 = (v[iBlk] || '').trim();
    const n2 = (v[iRsdt] || '').trim();
    const n3 = (v[iRsdt2] || '').trim();
    const lng = parseFloat(v[iLng]);
    const lat = parseFloat(v[iLat]);
    if (!isFinite(lng) || !isFinite(lat) || !n1) continue;
    let label = n1;
    if (n2) label += '-' + n2;
    if (n3) label += '-' + n3;
    out.push({ machiaza: machiazaName, label, lng, lat });
  }
}

async function main() {
  const baseUrl = `${ADDR_API_BASE}/${encodeURIComponent(ADDR_PREF)}/${encodeURIComponent(ADDR_CITY)}`;
  console.log(`市区町村データ取得: ${baseUrl}.json`);
  const cityRes = await fetch(`${baseUrl}.json`);
  if (!cityRes.ok) throw new Error(`市区町村データ取得失敗 (HTTP ${cityRes.status})`);
  const cityJson = await cityRes.json();

  const ranges = (cityJson.data || [])
    .filter(m => m.rsdt && m.csv_ranges && m.csv_ranges['住居表示'])
    .map(m => ({
      machiazaName: (m.oaza_cho || '') + (m.chome || ''),
      start: m.csv_ranges['住居表示'].start,
      length: m.csv_ranges['住居表示'].length,
    }))
    .filter(r => TARGET_OAZA.some(o => r.machiazaName.startsWith(o)));

  if (!ranges.length) throw new Error('対象の町丁目が見つかりません');
  console.log(`対象町丁目: ${ranges.length}件`);

  const txtUrl = `${baseUrl}-住居表示.txt`;
  const raw = [];
  for (const r of ranges) {
    const res = await fetch(txtUrl, {
      headers: { Range: `bytes=${r.start}-${r.start + r.length - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      console.warn(`取得失敗: ${r.machiazaName} (HTTP ${res.status})`);
      continue;
    }
    parseAddrSection(await res.text(), r.machiazaName, raw);
    console.log(`  ${r.machiazaName}: 累計 ${raw.length}件`);
  }

  // 重複除去(同一住所ラベル)+ 外れ値除去
  const seen = new Set();
  const all = raw.filter(p => {
    const key = `${p.machiaza}|${p.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return distanceMeters(p, CENTER) <= MAX_DIST_FROM_CENTER_M;
  });

  // 出発点(小舟町8-6)を解決
  const startHit = all.find(p => p.machiaza === START_MACHIAZA && p.label === START_LABEL);
  if (!startHit) console.warn(`警告: 出発点 ${START_MACHIAZA}${START_LABEL} が見つかりません。中心座標で代用します。`);
  const start = {
    name: 'RYS 小舟町店',
    addr: `${START_MACHIAZA}${START_LABEL}`,
    lng: +(startHit ? startHit.lng : CENTER.lng).toFixed(6),
    lat: +(startHit ? startHit.lat : CENTER.lat).toFixed(6),
  };

  // 正規ソート → 町丁目ごとにシード付き抽出(再実行しても同じ結果になる)
  all.sort((a, b) => a.machiaza.localeCompare(b.machiaza, 'ja') || a.label.localeCompare(b.label, 'ja'));
  const byMachiaza = new Map();
  for (const p of all) {
    if (!byMachiaza.has(p.machiaza)) byMachiaza.set(p.machiaza, []);
    byMachiaza.get(p.machiaza).push(p);
  }
  const addresses = [];
  for (const [name, list] of byMachiaza) {
    const rand = mulberry32(xmur3(`rys-kentei-v${VERSION}-${name}`)());
    const picked = seededShuffle(list.slice(), rand).slice(0, MAX_PER_MACHIAZA);
    picked.sort((a, b) => a.label.localeCompare(b.label, 'ja'));
    for (const p of picked) {
      addresses.push({ a: p.machiaza, l: p.label, lng: +p.lng.toFixed(6), lat: +p.lat.toFixed(6) });
    }
  }

  const out = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    source: 'Geolonia Japanese Addresses v2 (アドレス・ベース・レジストリ由来)',
    attribution: '出典: Geolonia 住所データ / デジタル庁 アドレス・ベース・レジストリ (CC BY 4.0)',
    start,
    addresses,
  };

  const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'questions.json');
  writeFileSync(outPath, JSON.stringify(out), 'utf8');
  console.log(`出力: ${outPath} (${addresses.length}件, 町丁目 ${byMachiaza.size})`);
}

main().catch(e => { console.error(e); process.exit(1); });
