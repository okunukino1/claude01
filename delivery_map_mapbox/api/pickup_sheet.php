<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('Expires: 0');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  echo json_encode(['error' => 'GETのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$spreadsheetId = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';
$allowedSheets = [
  '小舟町店' => 2042847900,
  '小舟町店スポット' => 728416139,
  '浜町店 南' => 1102972916,
  '浜町店 南スポット' => null,
  '浜町店 北' => 591145494,
  '浜町店 北スポット' => null,
];

date_default_timezone_set('Asia/Tokyo');

$sheet = trim((string)($_GET['sheet'] ?? '小舟町店'));
if (!array_key_exists($sheet, $allowedSheets)) {
  http_response_code(400);
  echo json_encode(['error' => '未対応のシートです'], JSON_UNESCAPED_UNICODE);
  exit;
}

$spotSheets = ['小舟町店スポット', '浜町店 南スポット', '浜町店 北スポット'];
$isSpotSheet = in_array($sheet, $spotSheets, true);
$gid = $allowedSheets[$sheet];
$cacheBust = (string)round(microtime(true) * 1000);
$urls = [
  'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
    . '/gviz/tq?tqx=out:csv&sheet=' . rawurlencode($sheet)
    . '&_=' . rawurlencode($cacheBust),
];
if ($gid !== null && $gid !== '') {
  array_unshift(
    $urls,
    'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
      . '/gviz/tq?tqx=out:csv&gid=' . rawurlencode((string)$gid)
      . '&_=' . rawurlencode($cacheBust)
  );
  array_unshift(
    $urls,
    'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
      . '/export?format=csv&gid=' . rawurlencode((string)$gid)
      . '&_=' . rawurlencode($cacheBust)
  );
}

function fetch_csv_url($url) {
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    CURLOPT_HTTPHEADER => [
      'Accept: text/csv,text/plain,*/*',
      'Accept-Language: ja,en;q=0.9',
      'Cache-Control: no-cache',
      'Pragma: no-cache',
    ],
  ]);
  $body = curl_exec($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
  $curlErr = curl_error($ch);
  curl_close($ch);

  return [
    'url' => $url,
    'body' => $body,
    'httpCode' => $httpCode,
    'contentType' => $contentType,
    'curlErr' => $curlErr,
  ];
}

$body = false;
$lastError = '';
$lastHttpCode = 0;
$debugAttempts = [];
foreach ($urls as $url) {
  $attempt = fetch_csv_url($url);
  $lastHttpCode = (int)$attempt['httpCode'];
  $debugAttempts[] = [
    'httpCode' => $attempt['httpCode'],
    'contentType' => $attempt['contentType'],
    'curlErr' => $attempt['curlErr'],
    'bodyLen' => is_string($attempt['body']) ? strlen($attempt['body']) : null,
  ];
  if ($attempt['body'] !== false && $attempt['httpCode'] >= 200 && $attempt['httpCode'] < 300) {
    $body = $attempt['body'];
    break;
  }
  $lastError = $attempt['curlErr'] ?: ('HTTP ' . $attempt['httpCode']);
}

if ($body === false) {
  http_response_code(502);
  $message = 'Googleスプレッドシートを取得できませんでした';
  if (in_array($lastHttpCode, [401, 403], true)) {
    $message = 'Googleスプレッドシートを取得できませんでした。共有設定を「リンクを知っている全員が閲覧可」にしてください';
  }
  echo json_encode([
    'error' => $message,
    'detail' => $lastError,
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

function normalize_header($value) {
  return strtolower(trim((string)$value));
}

function truthy_cell($value) {
  $v = strtoupper(trim((string)$value));
  return in_array($v, ['TRUE', '1', 'YES', 'Y', 'ON', 'CHECKED', '済', '○'], true);
}

function value_at($row, $indexMap, $name) {
  if (!isset($indexMap[$name])) return '';
  $idx = $indexMap[$name];
  return isset($row[$idx]) ? trim((string)$row[$idx]) : '';
}

function normalize_date_key($value) {
  $v = trim((string)$value);
  if ($v === '') return '';
  $digits = preg_replace('/\D+/', '', $v);
  if (strlen($digits) >= 8) return substr($digits, 0, 8);
  return $digits;
}

$fp = fopen('php://temp', 'r+');
fwrite($fp, $body);
rewind($fp);

$rows = [];
while (($row = fgetcsv($fp)) !== false) {
  $rows[] = $row;
}
fclose($fp);

if (count($rows) < 1) {
  if ($isSpotSheet) {
    echo json_encode([
      'spreadsheetId' => $spreadsheetId,
      'sheet' => $sheet,
      'dateFilter' => date('Ymd'),
      'count' => 0,
      'items' => [],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
  http_response_code(502);
  echo json_encode([
    'error' => '集荷リストにヘッダー行がありません',
    'sheet' => $sheet,
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$headers = array_map('normalize_header', $rows[0]);
$indexMap = [];
foreach ($headers as $i => $name) {
  if ($name !== '') $indexMap[$name] = $i;
}

if (!isset($indexMap['address'])) {
  if ($isSpotSheet) {
    echo json_encode([
      'spreadsheetId' => $spreadsheetId,
      'sheet' => $sheet,
      'dateFilter' => date('Ymd'),
      'count' => 0,
      'items' => [],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
  http_response_code(502);
  echo json_encode([
    'error' => 'address列が見つかりません。スプレッドシートの共有設定を「リンクを知っている全員が閲覧可」にするか、列名を確認してください。',
    'sheet' => $sheet,
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$items = [];
$todayKey = date('Ymd');
for ($i = 1; $i < count($rows); $i++) {
  $row = $rows[$i];
  $address = value_at($row, $indexMap, 'address');
  if ($address === '') continue;
  $dateValue = value_at($row, $indexMap, 'date');
  if ($isSpotSheet && normalize_date_key($dateValue) !== $todayKey) continue;
  $method = value_at($row, $indexMap, 'method');
  $isCancelled = trim($method) === 'キャンセル';

  $items[] = [
    'row' => $i + 1,
    'sheet' => $sheet,
    'id' => value_at($row, $indexMap, 'id'),
    'company' => value_at($row, $indexMap, 'company'),
    'address' => $address,
    'time' => value_at($row, $indexMap, 'time'),
    'method' => $method,
    'notes' => value_at($row, $indexMap, 'notes'),
    'phone' => value_at($row, $indexMap, 'phone'),
    'date' => $dateValue,
    'source' => value_at($row, $indexMap, 'source'),
    'list_tab' => value_at($row, $indexMap, 'list_tab'),
    'lat' => value_at($row, $indexMap, 'lat'),
    'lng' => value_at($row, $indexMap, 'lng'),
    'approx' => value_at($row, $indexMap, 'approx'),
    'formatted' => value_at($row, $indexMap, 'formatted'),
    'collected' => $isCancelled ? true : truthy_cell(value_at($row, $indexMap, 'collected')),
    'collected_at' => value_at($row, $indexMap, 'collected_at'),
    'collected_by' => $isCancelled ? 'キャンセル' : value_at($row, $indexMap, 'collected_by'),
  ];
}

echo json_encode([
  'spreadsheetId' => $spreadsheetId,
  'sheet' => $sheet,
  'dateFilter' => $isSpotSheet ? $todayKey : '',
  'count' => count($items),
  'items' => $items,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
