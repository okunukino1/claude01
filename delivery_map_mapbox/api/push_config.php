<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/push_common.php';

$enabled = push_is_configured();
echo json_encode([
  'ok' => true,
  'enabled' => $enabled,
  'publicKey' => $enabled ? push_cfg('PUSH_VAPID_PUBLIC_KEY') : '',
  'courses' => push_allowed_courses(),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
