<?php
// このファイルを config.php にコピーして使います。
// APIキーはブラウザ側に置かず、ここだけに保存します。
//
// === Mapbox版 (delivery_map_mapbox) の設定 ===
// 既存の Google Maps 版とは別フォルダで動作する独立アプリです。

// === アプリ/API呼び出しを許可するホスト ===
// OCR・住所検索などのサーバーAPIを、ここにあるホストからの呼び出しに制限します。
// 本番ドメインを変更した場合は追加してください。
define('APP_ALLOWED_HOSTS', ['rys-services.com', 'www.rys-services.com']);

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

// === Mapbox 車用ルート最適化 ===
// 未設定の場合は MAPBOX_ACCESS_TOKEN を使います。
// MAPBOX_ACCESS_TOKEN にURL制限をかけていてサーバー側APIが403になる場合は、
// Mapboxでサーバー用トークンを別途発行し、ここに設定してください。
define('MAPBOX_OPTIMIZATION_TOKEN', '');

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

// === Google Routes API 車用ルート最適化 ===
// 未設定の場合は GOOGLE_MAPS_SERVER_KEY を使います。
// Google Cloudで Routes API を有効化してください。
define('GOOGLE_ROUTES_API_KEY', '');

// === テスト版 共有ジオコードキャッシュ用 MySQL ===
// お名前.comの管理画面でMySQLデータベースを作成し、接続情報を入れてください。
// テスト版だけが api/delivery_geocode_cache_test.php 経由で使用します。
define('GEOCODE_CACHE_TEST_DB_HOST', 'mysql.example.ne.jp');
define('GEOCODE_CACHE_TEST_DB_PORT', 3306);
define('GEOCODE_CACHE_TEST_DB_NAME', 'database_name');
define('GEOCODE_CACHE_TEST_DB_USER', 'database_user');
define('GEOCODE_CACHE_TEST_DB_PASSWORD', 'database_password');
define('GEOCODE_CACHE_TEST_DB_TABLE', 'delivery_geocode_cache_test');
define('GEOCODE_CACHE_TEST_DB_MAX_ITEMS', 50000);

// === 集荷進捗 → Googleスプレッドシート書き戻し ===
// apps_script/pickup_progress.gs をGoogle Apps Scriptへ貼り付けてWebアプリとしてデプロイし、
// 発行された /exec URL を入れてください。
define('PICKUP_PROGRESS_WEBAPP_URL', 'https://script.google.com/macros/s/.../exec');

// Apps Script側の PICKUP_PROGRESS_SECRET と同じ値にしてください。
// 推測されにくい長い文字列にします。
define('PICKUP_PROGRESS_SECRET', 'change-this-secret');

// === 定期集荷ピン固定位置の管理者PIN ===
// 定期集荷の lat/lng をスプレッドシートへ保存できる人だけに共有してください。
define('PICKUP_LOCATION_ADMIN_PIN', 'change-this-admin-pin');

// === エコ配 スポット集荷 自動取得 ===
// エコ配のログイン情報です。ブラウザ側には出さず、サーバー上の config.php だけに保存します。
define('ECOHAI_USER_ID', 'change-this-user-id');
define('ECOHAI_USER_PASS', 'change-this-password');

// GitHub Actions から spot_pickups_refresh.php を呼ぶ時の共有シークレットです。
// 例: https://your-domain.com/delivery_map_mapbox/api/spot_pickups_refresh.php?secret=...
define('SPOT_PICKUP_REFRESH_SECRET', 'change-this-refresh-secret');

// アプリ起動時のスポット集荷取得は、短時間に連続実行されないよう間隔を空けます。
define('SPOT_PICKUP_TOUCH_MIN_INTERVAL_SECONDS', 300);

// === スポット集荷 Web Push通知 ===
// VAPID鍵は一度発行した同じ組を継続して使います。秘密鍵はブラウザ側へ公開しません。
// iPhoneはホーム画面に追加したWebアプリで通知を許可すると受信できます。
define('PUSH_VAPID_PUBLIC_KEY', 'change-this-vapid-public-key');
define('PUSH_VAPID_PRIVATE_KEY', 'change-this-vapid-private-key');
define('PUSH_VAPID_SUBJECT', 'mailto:change-this-contact@example.com');

// スポット集荷取得対象
// SPOT_PICKUP_TARGETS を設定すると複数POTをまとめて取得できます。
define('SPOT_PICKUP_TARGETS', [
  [
    'label' => '小舟1',
    'area' => '10',
    'shop' => '0220',
    'pot' => '07021644139',
    'sheet' => '小舟町店スポット',
  ],
  [
    'label' => '浜町1',
    'area' => '10',
    'shop' => '0262',
    'pot' => '07012121206',
    'sheet' => '浜町店 南スポット',
  ],
  [
    'label' => '浜町2',
    'area' => '10',
    'shop' => '0262',
    'pot' => '08059046995',
    'sheet' => '浜町店 北スポット',
  ],
]);

// 旧設定名です。SPOT_PICKUP_TARGETS 未設定の場合の小舟1用として使われます。
define('SPOT_PICKUP_TARGET_LABEL', '小舟1');
define('SPOT_PICKUP_TARGET_AREA', '10');
define('SPOT_PICKUP_TARGET_SHOP', '0220');
define('SPOT_PICKUP_TARGET_POT', '07021644139');
define('SPOT_PICKUP_SHEET_NAME', '小舟町店スポット');
