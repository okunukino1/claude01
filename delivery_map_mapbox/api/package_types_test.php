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

const PACKAGE_TYPE_SPREADSHEET_ID = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';
const PACKAGE_TYPE_SHEET_NAME = '荷物情報マスター';

function package_type_normalize_header($value) {
  return strtolower(trim((string)$value));
}

function package_type_truthy($value) {
  $normalized = strtoupper(trim((string)$value));
  return in_array($normalized, ['TRUE', '1', 'YES', 'Y', 'ON', '有効', '○'], true);
}

function package_type_csv_rows($csv) {
  if (!is_string($csv) || $csv === '') return [];
  $fp = fopen('php://temp', 'r+');
  if ($fp === false) return [];
  fwrite($fp, $csv);
  rewind($fp);
  $rows = [];
  while (($row = fgetcsv($fp, null, ',', '"', '')) !== false) {
    $rows[] = $row;
  }
  fclose($fp);
  return $rows;
}

function package_type_items_from_rows($rows) {
  if (!is_array($rows) || count($rows) < 2) return [];
  $headers = array_map('package_type_normalize_header', $rows[0]);
  $indexMap = [];
  foreach ($headers as $index => $name) {
    if ($name !== '') $indexMap[$name] = $index;
  }
  if (!isset($indexMap['label'])) return [];

  $items = [];
  $seen = [];
  for ($rowIndex = 1; $rowIndex < count($rows); $rowIndex++) {
    $row = $rows[$rowIndex];
    $label = trim((string)($row[$indexMap['label']] ?? ''));
    if ($label === '') continue;
    if (isset($indexMap['enabled'])) {
      $enabled = (string)($row[$indexMap['enabled']] ?? '');
      if (!package_type_truthy($enabled)) continue;
    }
    $dedupeKey = function_exists('mb_strtolower')
      ? mb_strtolower($label, 'UTF-8')
      : strtolower($label);
    if (isset($seen[$dedupeKey])) continue;
    $seen[$dedupeKey] = true;
    $id = isset($indexMap['id']) ? trim((string)($row[$indexMap['id']] ?? '')) : '';
    $sortOrder = isset($indexMap['sort_order'])
      ? (int)($row[$indexMap['sort_order']] ?? 0)
      : ($rowIndex * 10);
    $items[] = [
      'id' => $id !== '' ? substr($id, 0, 80) : ('package-' . $rowIndex),
      'label' => function_exists('mb_substr') ? mb_substr($label, 0, 80, 'UTF-8') : substr($label, 0, 80),
      'sortOrder' => $sortOrder,
      '_row' => $rowIndex,
    ];
  }

  usort($items, function ($a, $b) {
    $order = $a['sortOrder'] <=> $b['sortOrder'];
    return $order !== 0 ? $order : ($a['_row'] <=> $b['_row']);
  });

  return array_map(function ($item) {
    unset($item['_row']);
    return $item;
  }, $items);
}

function package_type_fetch_google_csv() {
  if (!function_exists('curl_init')) return '';
  $url = 'https://docs.google.com/spreadsheets/d/' . rawurlencode(PACKAGE_TYPE_SPREADSHEET_ID)
    . '/gviz/tq?tqx=out:csv&sheet=' . rawurlencode(PACKAGE_TYPE_SHEET_NAME)
    . '&_=' . rawurlencode((string)round(microtime(true) * 1000));
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 3,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT => 'RYS Delivery Map Package Catalog',
    CURLOPT_HTTPHEADER => [
      'Accept: text/csv,text/plain,*/*',
      'Accept-Language: ja,en;q=0.9',
      'Cache-Control: no-cache',
    ],
  ]);
  $body = curl_exec($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return is_string($body) && $httpCode >= 200 && $httpCode < 300 ? $body : '';
}

$source = 'google-sheet';
$rows = package_type_csv_rows(package_type_fetch_google_csv());
$items = package_type_items_from_rows($rows);

if (count($items) === 0) {
  $source = 'bundled-spreadsheet';
  $fallbackPath = __DIR__ . '/../test/data/package_types_master.csv';
  $fallbackCsv = is_file($fallbackPath) ? file_get_contents($fallbackPath) : '';
  $items = package_type_items_from_rows(package_type_csv_rows($fallbackCsv));
}

if (count($items) === 0) {
  http_response_code(503);
  echo json_encode([
    'error' => '荷物情報マスターを読み込めませんでした',
    'sheet' => PACKAGE_TYPE_SHEET_NAME,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

echo json_encode([
  'spreadsheetId' => PACKAGE_TYPE_SPREADSHEET_ID,
  'sheet' => PACKAGE_TYPE_SHEET_NAME,
  'source' => $source,
  'count' => count($items),
  'items' => $items,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
