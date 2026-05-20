<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  http_response_code(405);
  echo json_encode(['error' => 'GETのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$path = dirname(__DIR__) . '/data/spot_pickups_cache.json';
if (!file_exists($path)) {
  echo json_encode([
    'date' => '',
    'updated_at' => '',
    'count' => 0,
    'items' => [],
    'cacheMissing' => true,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$data = json_decode((string)file_get_contents($path), true);
if (!is_array($data)) {
  http_response_code(502);
  echo json_encode(['error' => 'スポット集荷キャッシュを読み取れません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$items = isset($data['items']) && is_array($data['items']) ? $data['items'] : [];
$safeItems = [];
foreach ($items as $item) {
  if (!is_array($item)) continue;
  $safeItems[] = [
    'id' => (string)($item['id'] ?? ''),
    'source' => 'ecohai-spot',
    'date' => (string)($item['date'] ?? ($data['date'] ?? '')),
    'pot_label' => (string)($item['pot_label'] ?? ''),
    'pot' => (string)($item['pot'] ?? ''),
    'company' => (string)($item['company'] ?? ''),
    'time' => (string)($item['time'] ?? ''),
    'address' => (string)($item['address'] ?? ''),
    'phone' => (string)($item['phone'] ?? ''),
  ];
}

echo json_encode([
  'date' => (string)($data['date'] ?? ''),
  'updated_at' => (string)($data['updated_at'] ?? ''),
  'target' => $data['target'] ?? null,
  'count' => count($safeItems),
  'items' => $safeItems,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
