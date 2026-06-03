<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

function cache_path() {
  return dirname(__DIR__) . '/data/private/delivery_geocode_cache.json';
}

function read_cache() {
  $path = cache_path();
  if (!file_exists($path)) return ['items' => []];
  $data = json_decode((string)file_get_contents($path), true);
  if (!is_array($data)) return ['items' => []];
  if (!isset($data['items']) || !is_array($data['items'])) $data['items'] = [];
  return $data;
}

function write_cache($data) {
  $path = cache_path();
  $dir = dirname($path);
  if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    throw new RuntimeException('キャッシュ保存先を作成できません');
  }
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if ($json === false || file_put_contents($path, $json, LOCK_EX) === false) {
    throw new RuntimeException('キャッシュを書き込めません');
  }
}

function normalized_key($value) {
  $key = trim((string)$value);
  if ($key === '' || mb_strlen($key, 'UTF-8') > 300) return '';
  return hash('sha256', $key);
}

function finite_float($value) {
  if ($value === null || $value === '') return null;
  $n = (float)$value;
  return is_finite($n) ? $n : null;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$action = trim((string)($input['action'] ?? 'lookup'));
$key = normalized_key($input['key'] ?? '');
if ($key === '') {
  http_response_code(400);
  echo json_encode(['error' => 'キャッシュキーが不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

try {
  $cache = read_cache();

  if ($action === 'lookup') {
    $item = $cache['items'][$key] ?? null;
    if (!is_array($item)) {
      echo json_encode(['hit' => false], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }

    $lat = finite_float($item['lat'] ?? null);
    $lng = finite_float($item['lng'] ?? null);
    if ($lat === null || $lng === null) {
      unset($cache['items'][$key]);
      write_cache($cache);
      echo json_encode(['hit' => false], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }

    $item['hit_count'] = (int)($item['hit_count'] ?? 0) + 1;
    $item['last_used_at'] = date('c');
    $cache['items'][$key] = $item;
    write_cache($cache);

    echo json_encode([
      'hit' => true,
      'lat' => $lat,
      'lng' => $lng,
      'approx' => !empty($item['approx']),
      'formatted' => (string)($item['formatted'] ?? ''),
      'hit_count' => (int)$item['hit_count'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  if ($action === 'save') {
    $lat = finite_float($input['lat'] ?? null);
    $lng = finite_float($input['lng'] ?? null);
    if ($lat === null || $lng === null || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
      http_response_code(400);
      echo json_encode(['error' => '緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
      exit;
    }

    $address = trim((string)($input['address'] ?? ''));
    $formatted = trim((string)($input['formatted'] ?? ''));
    if (mb_strlen($address, 'UTF-8') > 300 || mb_strlen($formatted, 'UTF-8') > 300) {
      http_response_code(400);
      echo json_encode(['error' => '住所文字列が長すぎます'], JSON_UNESCAPED_UNICODE);
      exit;
    }

    $now = date('c');
    $existing = isset($cache['items'][$key]) && is_array($cache['items'][$key]) ? $cache['items'][$key] : [];
    $cache['items'][$key] = [
      'address' => $address,
      'lat' => $lat,
      'lng' => $lng,
      'approx' => !empty($input['approx']),
      'formatted' => $formatted,
      'saved_at' => (string)($existing['saved_at'] ?? $now),
      'updated_at' => $now,
      'last_used_at' => $now,
      'hit_count' => (int)($existing['hit_count'] ?? 0),
    ];

    if (count($cache['items']) > 2000) {
      uasort($cache['items'], function($a, $b) {
        return strcmp((string)($a['last_used_at'] ?? $a['updated_at'] ?? ''), (string)($b['last_used_at'] ?? $b['updated_at'] ?? ''));
      });
      $cache['items'] = array_slice($cache['items'], -2000, null, true);
    }

    write_cache($cache);
    echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  http_response_code(400);
  echo json_encode(['error' => '未対応の操作です'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => '共有キャッシュ処理に失敗しました', 'detail' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
