<?php
// Test-only operational OCR: Cloud Vision reads text, then Gemini selects the recipient fields.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function delivery_test_hybrid_respond($payload, $status = 200) {
  http_response_code((int)$status);
  echo json_encode(
    $payload,
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
  );
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  delivery_test_hybrid_respond(['ok' => false, 'error_code' => 'method_not_allowed', 'error' => 'POSTのみ対応しています'], 405);
}

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  delivery_test_hybrid_respond(['ok' => false, 'error_code' => 'not_configured', 'error' => 'サーバー設定ファイルがありません'], 503);
}
require_once $configFile;
require_once __DIR__ . '/request_guard.php';
require_once __DIR__ . '/extract_address_test_support.php';
require_once __DIR__ . '/extract_address_vision_test_support.php';
require_once __DIR__ . '/extract_address_hybrid_test_support.php';
delivery_app_require_same_origin_request();

if (!defined('GEMINI_API_KEY') || !GEMINI_API_KEY || GEMINI_API_KEY === 'AIza...ここにAPIキーを入れる...') {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => false,
    'stage' => 'selector',
    'error_code' => 'gemini_not_configured',
    'error' => 'Gemini APIキーが未設定です'
  ], 503);
}

$visionKeySource = '';
$visionApiKey = delivery_test_hybrid_vision_api_key($visionKeySource);
if ($visionApiKey === '') {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'vision',
    'error_code' => 'vision_not_configured',
    'error' => 'Cloud Vision比較用APIキーが未設定です',
    'vision' => delivery_test_hybrid_vision_summary([], 0, 'not_configured', 'Cloud Vision APIキーが未設定です')
  ], 503);
}

$rawBody = file_get_contents('php://input');
$contentType = strtolower(trim(strtok((string)($_SERVER['CONTENT_TYPE'] ?? ''), ';')));
$decodedImage = '';
$mimeType = $contentType;
if (strpos($contentType, 'image/') === 0) {
  if (strlen($rawBody) > 6 * 1024 * 1024) {
    delivery_test_hybrid_respond(['ok' => false, 'fallback_required' => false, 'error_code' => 'image_too_large', 'error' => '画像が大きすぎます'], 413);
  }
  $decodedImage = $rawBody;
} else {
  $input = json_decode($rawBody, true);
  if (!is_array($input)) {
    delivery_test_hybrid_respond(['ok' => false, 'fallback_required' => false, 'error_code' => 'invalid_request', 'error' => '画像またはJSONを送信してください'], 400);
  }
  $encoded = preg_replace('/\s+/', '', (string)($input['image'] ?? ''));
  $mimeType = strtolower((string)($input['mimeType'] ?? 'image/jpeg'));
  if ($encoded === '' || strlen($encoded) > 8 * 1024 * 1024) {
    delivery_test_hybrid_respond([
      'ok' => false,
      'fallback_required' => false,
      'error_code' => 'invalid_image',
      'error' => '画像データが不正です'
    ], $encoded === '' ? 400 : 413);
  }
  $decodedImage = base64_decode($encoded, true);
  if ($decodedImage === false) {
    delivery_test_hybrid_respond(['ok' => false, 'fallback_required' => false, 'error_code' => 'invalid_image', 'error' => '画像データを読み取れません'], 400);
  }
}

if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
  delivery_test_hybrid_respond(['ok' => false, 'fallback_required' => false, 'error_code' => 'unsupported_image', 'error' => '対応していない画像形式です'], 415);
}
$detectedMimeType = delivery_test_vision_detected_mime_type($decodedImage);
if ($detectedMimeType === '' || $detectedMimeType !== $mimeType) {
  delivery_test_hybrid_respond(['ok' => false, 'fallback_required' => false, 'error_code' => 'invalid_image_type', 'error' => '画像形式とContent-Typeが一致しません'], 415);
}

$totalStartedAt = microtime(true);
$visionRequest = [
  'requests' => [[
    'image' => ['content' => base64_encode($decodedImage)],
    'features' => [['type' => 'DOCUMENT_TEXT_DETECTION']],
    'imageContext' => ['languageHints' => ['ja']]
  ]]
];
$visionStartedAt = microtime(true);
$ch = curl_init('https://vision.googleapis.com/v1/images:annotate');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . $visionApiKey],
  CURLOPT_POSTFIELDS => json_encode($visionRequest, JSON_UNESCAPED_UNICODE),
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 20
]);
$visionBody = curl_exec($ch);
$visionCurlError = curl_error($ch);
$visionHttpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$visionElapsedMs = (int)round((microtime(true) - $visionStartedAt) * 1000);

if ($visionBody === false) {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'vision',
    'error_code' => 'vision_connection_failed',
    'error' => 'Cloud Vision APIへ接続できませんでした',
    'detail' => $visionCurlError,
    'vision' => delivery_test_hybrid_vision_summary([], $visionElapsedMs, 'connection_failed', $visionCurlError)
  ], 502);
}

$visionPayload = json_decode($visionBody, true);
if ($visionHttpCode < 200 || $visionHttpCode >= 300 || !is_array($visionPayload)) {
  $visionMessage = is_array($visionPayload)
    ? (string)($visionPayload['error']['message'] ?? 'Cloud Vision API応答エラー')
    : 'Cloud Vision APIのJSONを解析できませんでした';
  $visionErrorCode = $visionHttpCode === 429 ? 'quota_exceeded' : ($visionHttpCode === 403 ? 'key_rejected' : 'api_error');
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'vision',
    'error_code' => $visionErrorCode,
    'error' => 'Cloud Vision API応答エラー [HTTP ' . ($visionHttpCode ?: 502) . ']',
    'detail' => $visionMessage,
    'vision' => delivery_test_hybrid_vision_summary([], $visionElapsedMs, $visionErrorCode, $visionMessage)
  ], $visionHttpCode >= 400 ? $visionHttpCode : 502);
}

$vision = delivery_test_vision_parse_response($visionPayload);
$visionSummary = delivery_test_hybrid_vision_summary(
  $vision,
  $visionElapsedMs,
  empty($vision['ok']) ? (string)($vision['error_code'] ?? 'vision_error') : '',
  empty($vision['ok']) ? (string)($vision['error'] ?? 'Cloud Visionで文字を読み取れませんでした') : ''
);
if (empty($vision['ok']) || empty($vision['has_text'])) {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'vision',
    'error_code' => empty($vision['has_text']) ? 'vision_no_text' : (string)($vision['error_code'] ?? 'vision_error'),
    'error' => empty($vision['has_text']) ? 'Cloud Visionで文字を検出できませんでした' : (string)($vision['error'] ?? 'Cloud Visionで文字を読み取れませんでした'),
    'vision' => $visionSummary
  ], 422);
}

$model = defined('GEMINI_MODEL') && GEMINI_MODEL ? GEMINI_MODEL : 'gemini-2.5-flash-lite';
$selectorRequest = [
  'contents' => [[
    'role' => 'user',
    'parts' => [['text' => delivery_test_hybrid_prompt($vision)]]
  ]],
  'generationConfig' => [
    'temperature' => 0,
    'maxOutputTokens' => 768,
    'responseMimeType' => 'application/json',
    'responseSchema' => delivery_test_gemini_response_schema()
  ]
];
$selectorStartedAt = microtime(true);
$selectorUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
$ch = curl_init($selectorUrl);
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . GEMINI_API_KEY],
  CURLOPT_POSTFIELDS => json_encode($selectorRequest, JSON_UNESCAPED_UNICODE),
  CURLOPT_CONNECTTIMEOUT => 8,
  CURLOPT_TIMEOUT => 35
]);
$selectorBody = curl_exec($ch);
$selectorCurlError = curl_error($ch);
$selectorHttpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);
$selectorElapsedMs = (int)round((microtime(true) - $selectorStartedAt) * 1000);

if ($selectorBody === false) {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'selector',
    'error_code' => 'selector_connection_failed',
    'error' => 'Geminiの届け先選別へ接続できませんでした',
    'detail' => $selectorCurlError,
    'vision' => $visionSummary
  ], 502);
}

$selectorPayload = json_decode($selectorBody, true);
if ($selectorHttpCode < 200 || $selectorHttpCode >= 300) {
  $selectorMessage = is_array($selectorPayload)
    ? (string)($selectorPayload['error']['message'] ?? 'Gemini API応答エラー')
    : substr((string)$selectorBody, 0, 500);
  $canFallback = !in_array($selectorHttpCode, [401, 403, 429], true);
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => $canFallback,
    'stage' => 'selector',
    'error_code' => $selectorHttpCode === 429 ? 'selector_quota_exceeded' : 'selector_api_error',
    'error' => 'Geminiの届け先選別エラー [HTTP ' . $selectorHttpCode . ']',
    'detail' => $selectorMessage,
    'vision' => $visionSummary
  ], $selectorHttpCode);
}

$selectorText = '';
foreach (($selectorPayload['candidates'][0]['content']['parts'] ?? []) as $part) {
  if (isset($part['text'])) $selectorText .= $part['text'];
}
$selectorText = trim($selectorText);
$decodeError = '';
$result = delivery_test_decode_gemini_json($selectorText, $decodeError);
if (!is_array($result)) {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'selector',
    'error_code' => 'selector_invalid_json',
    'error' => 'Geminiの届け先選別結果を解析できませんでした',
    'detail' => $decodeError,
    'vision' => $visionSummary
  ], 502);
}

$result = delivery_test_normalize_ocr_result($result);
$unusableReason = '';
if (!delivery_test_hybrid_result_is_usable($result, $vision, $unusableReason)) {
  delivery_test_hybrid_respond([
    'ok' => false,
    'fallback_required' => true,
    'stage' => 'selector',
    'error_code' => $unusableReason,
    'error' => '文字情報だけでは届け先を確定できませんでした',
    'vision' => $visionSummary,
    'selector_elapsed_ms' => $selectorElapsedMs
  ], 422);
}

$result['ocr_mode'] = 'vision_gemini_text';
$result['vision_elapsed_ms'] = $visionElapsedMs;
$result['selector_elapsed_ms'] = $selectorElapsedMs;
delivery_test_hybrid_respond([
  'ok' => true,
  'mode' => 'vision_gemini_text',
  'result' => $result,
  'vision' => $visionSummary,
  'selector_elapsed_ms' => $selectorElapsedMs,
  'elapsed_ms' => (int)round((microtime(true) - $totalStartedAt) * 1000)
]);
