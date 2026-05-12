<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  echo json_encode(['error' => 'GETのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$spreadsheetId = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';
$allowedSheets = [
  '小舟町店' => 2042847900,
  '浜町店 南' => 1102972916,
  '浜町店 北' => 591145494,
];

$sheet = trim((string)($_GET['sheet'] ?? '小舟町店'));
if (!array_key_exists($sheet, $allowedSheets)) {
  http_response_code(400);
  echo json_encode(['error' => '未対応のシートです'], JSON_UNESCAPED_UNICODE);
  exit;
}

$checkedOnly = (string)($_GET['checked_only'] ?? '1') !== '0';
$gid = $allowedSheets[$sheet];
$urls = [
  'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
    . '/export?format=csv&gid=' . rawurlencode((string)$gid),
  'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
    . '/gviz/tq?tqx=out:csv&gid=' . rawurlencode((string)$gid),
  'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
    . '/gviz/tq?tqx=out:csv&sheet=' . rawurlencode($sheet),
];

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

$fp = fopen('php://temp', 'r+');
fwrite($fp, $body);
rewind($fp);

$rows = [];
while (($row = fgetcsv($fp)) !== false) {
  $rows[] = $row;
}
fclose($fp);

if (count($rows) < 2) {
  http_response_code(502);
  echo json_encode([
    'error' => '集荷リストに行データがありません',
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
  http_response_code(502);
  echo json_encode([
    'error' => 'address列が見つかりません。スプレッドシートの共有設定を「リンクを知っている全員が閲覧可」にするか、列名を確認してください。',
    'sheet' => $sheet,
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$items = [];
for ($i = 1; $i < count($rows); $i++) {
  $row = $rows[$i];
  $address = value_at($row, $indexMap, 'address');
  if ($address === '') continue;

  $checkedValue = value_at($row, $indexMap, 'checked');
  $checked = $checkedValue === '' ? true : truthy_cell($checkedValue);
  if ($checkedOnly && !$checked) continue;

  $items[] = [
    'row' => $i + 1,
    'id' => value_at($row, $indexMap, 'id'),
    'company' => value_at($row, $indexMap, 'company'),
    'address' => $address,
    'time' => value_at($row, $indexMap, 'time'),
    'method' => value_at($row, $indexMap, 'method'),
    'notes' => value_at($row, $indexMap, 'notes'),
    'checked' => $checked,
  ];
}

echo json_encode([
  'spreadsheetId' => $spreadsheetId,
  'sheet' => $sheet,
  'checkedOnly' => $checkedOnly,
  'count' => count($items),
  'items' => $items,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
