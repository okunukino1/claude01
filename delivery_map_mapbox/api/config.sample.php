<?php
// このファイルを config.php にコピーして使います。
// APIキーはブラウザ側に置かず、ここだけに保存します。
//
// === Mapbox版 (delivery_map_mapbox) の設定 ===
// 既存の Google Maps 版とは別フォルダで動作する独立アプリです。

// === 伝票写真 → 住所抽出用 Gemini APIキー ===
// Google AI Studioで作成したキーを入れてください。
// 既存版と同じものを流用できます。
define('GEMINI_API_KEY', 'AIza...Gemini APIキー...');
define('GEMINI_MODEL', 'gemini-2.5-flash-lite');

// === Mapbox 地図表示用 アクセストークン ===
// https://account.mapbox.com/ で発行する 'pk.' で始まるパブリックトークン。
// 月50,000マップロードまで無料。
// 公開URLにコードが置かれるため、Mapboxダッシュボードで
// 「URL restriction」(リファラー制限)を必ず設定してください。
//   例: https://your-domain.com/delivery_map_mapbox/*
define('MAPBOX_ACCESS_TOKEN', 'pk.eyJ...Mapbox公開トークン...');

// 使用する地図スタイル。デフォルトは Mapbox Standard (最新ベクター)。
// 他に試せる候補:
//   'mapbox://styles/mapbox/standard'        ← 推奨。建物3D、日本語対応、ピッチ・回転対応
//   'mapbox://styles/mapbox/streets-v12'     ← 従来型のシンプルスタイル
//   'mapbox://styles/mapbox/light-v11'       ← 配送用に建物が見やすい淡色
//   'mapbox://styles/mapbox/satellite-streets-v12' ← 衛星写真+道路
define('MAPBOX_STYLE', 'mapbox://styles/mapbox/standard');

// === 住所 → 緯度経度変換用 Google Geocoding APIキー ===
// 既存版と同じキーで動きます。地図はMapbox、ジオコーディングはGoogleで
// 役割を分けることで、住所解決精度はGoogle版と同じに保ちます。
// Google Cloudで Geocoding API を有効化してください。
define('GOOGLE_MAPS_SERVER_KEY', 'AIza...Google Geocoding API用キー...');

// === 集荷進捗 → Googleスプレッドシート書き戻し ===
// apps_script/pickup_progress.gs をGoogle Apps Scriptへ貼り付けてWebアプリとしてデプロイし、
// 発行された /exec URL を入れてください。
define('PICKUP_PROGRESS_WEBAPP_URL', 'https://script.google.com/macros/s/.../exec');

// Apps Script側の PICKUP_PROGRESS_SECRET と同じ値にしてください。
// 推測されにくい長い文字列にします。
define('PICKUP_PROGRESS_SECRET', 'change-this-secret');
