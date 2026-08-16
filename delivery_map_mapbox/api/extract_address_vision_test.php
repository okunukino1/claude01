<?php
// Test-only shadow OCR endpoint. It never replaces the Gemini result used by the app.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['ok' => false, 'error_code' => 'method_not_allowed', 'error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(503);
  echo json_encode(['ok' => false, 'error_code' => 'not_configured', 'error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/request_guard.php';
require_once __DIR__ . '/extract_address_vision_test_support.php';
delivery_app_require_same_origin_request();

$apiKey = '';
$keySource = '';
if (defined('GOOGLE_CLOUD_VISION_TEST_API_KEY')) {
  $candidate = trim((string)GOOGLE_CLOUD_VISION_TEST_API_KEY);
  if ($candidate !== '' && strpos($candidate, 'ここに') === false && strpos($candidate, 'AIza...') !== 0) {
    $apiKey = $candidate;
    $keySource = 'dedicated';
  }
}
if ($apiKey === '' && defined('GEMINI_API_KEY')) {
  $candidate = trim((string)GEMINI_API_KEY);
  if ($candidate !== '' && strpos($candidate, 'ここに') === false && strpos($candidate, 'AIza...') !== 0) {
    $apiKey = $candidate;
    $keySource = 'gemini-project';
  }
}
if ($apiKey === '') {
  http_response_code(503);
  echo json_encode([
    'ok' => false,
    'error_code' => 'not_configured',
    'error' => 'Cloud Vision比較用APIキーが未設定です'
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$rawBody = file_get_contents('php://input');
$contentType = strtolower(trim(strtok((string)($_SERVER['CONTENT_TYPE'] ?? ''), ';')));
$decodedImage = '';
$mimeType = $contentType;
if (strpos($contentType, 'image/') === 0) {
  if (strlen($rawBody) > 6 * 1024 * 1024) {
    http_response_code(413);
    echo json_encode(['ok' => false, 'error_code' => 'image_too_large', 'error' => '画像が大きすぎます'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $decodedImage = $rawBody;
} else {
  $input = json_decode($rawBody, true);
  if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error_code' => 'invalid_request', 'error' => '画像またはJSONを送信してください'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $encoded = preg_replace('/\s+/', '', (string)($input['image'] ?? ''));
  $mimeType = strtolower((string)($input['mimeType'] ?? 'image/jpeg'));
  if ($encoded === '' || strlen($encoded) > 8 * 1024 * 1024) {
    http_response_code($encoded === '' ? 400 : 413);
    echo json_encode(['ok' => false, 'error_code' => 'invalid_image', 'error' => '画像データが不正です'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $decodedImage = base64_decode($encoded, true);
  if ($decodedImage === false) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error_code' => 'invalid_image', 'error' => '画像データを読み取れません'], JSON_UNESCAPED_UNICODE);
    exit;
  }
}

if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
  http_response_code(415);
  echo json_encode(['ok' => false, 'error_code' => 'unsupported_image', 'error' => '比較OCRが対応していない画像形式です'], JSON_UNESCAPED_UNICODE);
  exit;
}
if ($decodedImage === '') {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error_code' => 'invalid_image', 'error' => '画像が空です'], JSON_UNESCAPED_UNICODE);
  exit;
}
$detectedMimeType = delivery_test_vision_detected_mime_type($decodedImage);
if ($detectedMimeType === '' || $detectedMimeType !== $mimeType) {
  http_response_code(415);
  echo json_encode(['ok' => false, 'error_code' => 'invalid_image_type', 'error' => '画像形式とContent-Typeが一致しません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$requestBody = [
  'requests' => [[
    'image' => ['content' => base64_encode($decodedImage)],
    'features' => [['type' => 'DOCUMENT_TEXT_DETECTION']],
    'imageContext' => ['languageHints' => ['ja']]
  ]]
];

$startedAt = microtime(true);
$ch = curl_init('https://vision.googleapis.com/v1/images:annotate');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $apiKey],
  CURLOPT_POSTFIELDS => json_encode($requestBody, JSON_UNESCAPED_UNICODE),
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 20
]);
$responseBody = curl_exec($ch);
$curlError = curl_error($ch);
$httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$elapsedMs = (int)round((microtime(true) - $startedAt) * 1000);

if ($responseBody === false) {
  http_response_code(502);
  echo json_encode([
    'ok' => false,
    'error_code' => 'connection_failed',
    'error' => 'Cloud Vision APIへ接続できませんでした',
    'detail' => $curlError,
    'elapsed_ms' => $elapsedMs
  ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}

$payload = json_decode($responseBody, true);
if ($httpCode < 200 || $httpCode >= 300 || !is_array($payload)) {
  $message = is_array($payload)
    ? (string)($payload['error']['message'] ?? 'Cloud Vision API応答エラー')
    : 'Cloud Vision APIのJSONを解析できませんでした';
  $lower = strtolower($message);
  $errorCode = 'api_error';
  if ($httpCode === 403 && (strpos($lower, 'disabled') !== false || strpos($lower, 'not been used') !== false)) $errorCode = 'service_disabled';
  elseif ($httpCode === 403) $errorCode = 'key_rejected';
  elseif ($httpCode === 429) $errorCode = 'quota_exceeded';
  elseif ($httpCode >= 500) $errorCode = 'upstream_error';
  http_response_code($httpCode >= 400 ? $httpCode : 502);
  echo json_encode([
    'ok' => false,
    'error_code' => $errorCode,
    'error' => 'Cloud Vision API応答エラー [HTTP ' . ($httpCode ?: 502) . ']',
    'detail' => $message,
    'elapsed_ms' => $elapsedMs,
    'key_source' => $keySource
  ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
  exit;
}

$result = delivery_test_vision_parse_response($payload);
$result['elapsed_ms'] = $elapsedMs;
$result['key_source'] = $keySource;
if (empty($result['ok'])) http_response_code(502);
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
