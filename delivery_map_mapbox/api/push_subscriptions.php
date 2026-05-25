<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/push_common.php';

try {
  $body = json_decode((string)file_get_contents('php://input'), true);
  if (!is_array($body)) throw new InvalidArgumentException('送信データが正しくありません');
  $action = trim((string)($body['action'] ?? ''));

  if ($action === 'save') {
    if (!push_is_configured()) {
      http_response_code(503);
      echo json_encode(['error' => '通知サーバー設定が未完了です'], JSON_UNESCAPED_UNICODE);
      exit;
    }
    $saved = push_save_subscription($body['subscription'] ?? [], $body['courses'] ?? []);
    echo json_encode(['ok' => true, 'courses' => $saved['courses']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  if ($action === 'remove') {
    push_remove_subscription($body['endpoint'] ?? '');
    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
  }

  http_response_code(400);
  echo json_encode(['error' => '未対応の操作です'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  http_response_code(400);
  echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
