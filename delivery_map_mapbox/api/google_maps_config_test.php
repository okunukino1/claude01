<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/request_guard.php';
delivery_app_reject_disallowed_browser_origin();

// サーバー用キーは絶対に公開しない。HTTPリファラー制限を設定した
// Maps JavaScript API専用ブラウザーキーだけをテスト版へ渡す。
$key = defined('GOOGLE_MAPS_BROWSER_KEY')
  ? trim((string)GOOGLE_MAPS_BROWSER_KEY)
  : '';
$placeholder = 'AIza...Google Maps JavaScript API用キー...';

echo json_encode([
  'available' => $key !== '' && $key !== $placeholder,
  'googleMapsBrowserKey' => $key !== $placeholder ? $key : '',
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
