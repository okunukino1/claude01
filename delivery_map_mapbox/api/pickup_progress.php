<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

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

$webappUrl = defined('PICKUP_PROGRESS_WEBAPP_URL') ? trim((string)PICKUP_PROGRESS_WEBAPP_URL) : '';
$secret = defined('PICKUP_PROGRESS_SECRET') ? trim((string)PICKUP_PROGRESS_SECRET) : '';
if ($webappUrl === '' || $secret === '' ||
    $webappUrl === 'https://script.google.com/macros/s/.../exec' ||
    $secret === 'change-this-secret') {
  http_response_code(500);
  echo json_encode([
    'error' => '集荷進捗の書き込み設定が未設定です',
    'detail' => 'api/config.php の PICKUP_PROGRESS_WEBAPP_URL と PICKUP_PROGRESS_SECRET を設定してください',
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$allowedSheets = ['小舟町店', '浜町店 南', '浜町店 北'];
$sheet = trim((string)($input['sheet'] ?? ''));
$row = (int)($input['row'] ?? 0);
$pickupId = trim((string)($input['id'] ?? ''));
$collected = !empty($input['collected']);
$collectedBy = trim((string)($input['collected_by'] ?? ''));

if (!in_array($sheet, $allowedSheets, true)) {
  http_response_code(400);
  echo json_encode(['error' => '未対応のシートです'], JSON_UNESCAPED_UNICODE);
  exit;
}
if ($row < 2 || $row > 10000) {
  http_response_code(400);
  echo json_encode(['error' => '行番号が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
if ($collected && $collectedBy === '') {
  http_response_code(400);
  echo json_encode(['error' => '担当者名が空です'], JSON_UNESCAPED_UNICODE);
  exit;
}
if (mb_strlen($collectedBy, 'UTF-8') > 50) {
  http_response_code(400);
  echo json_encode(['error' => '担当者名が長すぎます'], JSON_UNESCAPED_UNICODE);
  exit;
}

$now = new DateTime('now', new DateTimeZone('Asia/Tokyo'));
$payload = [
  'action' => 'pickupProgress',
  'secret' => $secret,
  'sheet' => $sheet,
  'row' => $row,
  'id' => $pickupId,
  'collected' => $collected,
  'collected_at' => $collected ? $now->format(DateTime::ATOM) : '',
  'collected_by' => $collected ? $collectedBy : '',
];

$ch = curl_init($webappUrl);
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 20,
  CURLOPT_FOLLOWLOCATION => true,
  CURLOPT_MAXREDIRS => 5,
  CURLOPT_SSL_VERIFYPEER => false,
  CURLOPT_SSL_VERIFYHOST => false,
  CURLOPT_POST => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
  CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
]);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

if ($response === false || $httpCode < 200 || $httpCode >= 300) {
  http_response_code(502);
  echo json_encode([
    'error' => 'スプレッドシート更新に失敗しました',
    'detail' => $curlErr ?: ('HTTP ' . $httpCode),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$data = json_decode($response, true);
if (!is_array($data) || empty($data['ok'])) {
  http_response_code(502);
  echo json_encode([
    'error' => 'スプレッドシート更新に失敗しました',
    'detail' => is_array($data) && isset($data['error']) ? $data['error'] : substr((string)$response, 0, 300),
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

echo json_encode([
  'ok' => true,
  'sheet' => $sheet,
  'row' => $row,
  'collected' => $collected,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
