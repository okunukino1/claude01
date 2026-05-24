<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません', 'hint' => 'api/config.php を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

function cfg($name, $default = '') {
  return defined($name) ? trim((string)constant($name)) : $default;
}

$secret = cfg('SPOT_PICKUP_REFRESH_SECRET');
$givenSecret = trim((string)($_GET['secret'] ?? $_POST['secret'] ?? ''));
if ($secret === '' || $secret === 'change-this-refresh-secret' || !hash_equals($secret, $givenSecret)) {
  http_response_code(403);
  echo json_encode(['error' => 'スポット集荷取得の認証に失敗しました'], JSON_UNESCAPED_UNICODE);
  exit;
}

$userId = cfg('ECOHAI_USER_ID');
$userPass = cfg('ECOHAI_USER_PASS');
if ($userId === '' || $userId === 'change-this-user-id' || $userPass === '' || $userPass === 'change-this-password') {
  http_response_code(500);
  echo json_encode(['error' => 'エコ配ログイン情報が未設定です', 'hint' => 'api/config.php の ECOHAI_USER_ID / ECOHAI_USER_PASS を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

date_default_timezone_set('Asia/Tokyo');

function spot_pickup_targets() {
  if (defined('SPOT_PICKUP_TARGETS') && is_array(SPOT_PICKUP_TARGETS)) {
    $targets = [];
    foreach (SPOT_PICKUP_TARGETS as $target) {
      if (!is_array($target)) continue;
      $targets[] = [
        'label' => trim((string)($target['label'] ?? '')),
        'area' => trim((string)($target['area'] ?? '')),
        'shop' => trim((string)($target['shop'] ?? '')),
        'pot' => trim((string)($target['pot'] ?? '')),
        'sheet' => trim((string)($target['sheet'] ?? '')),
      ];
    }
    $targets = array_values(array_filter($targets, function($target) {
      return $target['label'] !== '' && $target['area'] !== '' && $target['shop'] !== '' && $target['pot'] !== '' && $target['sheet'] !== '';
    }));
    if (count($targets) > 0) return $targets;
  }

  return [
    [
      'label' => cfg('SPOT_PICKUP_TARGET_LABEL', '小舟1'),
      'area' => cfg('SPOT_PICKUP_TARGET_AREA', '10'),
      'shop' => cfg('SPOT_PICKUP_TARGET_SHOP', '0220'),
      'pot' => cfg('SPOT_PICKUP_TARGET_POT', '07021644139'),
      'sheet' => cfg('SPOT_PICKUP_SHEET_NAME', '小舟町店スポット'),
    ],
    [
      'label' => '浜町1',
      'area' => '10',
      'shop' => '0262',
      'pot' => '07012121206',
      'sheet' => '浜町店 南スポット',
    ],
    [
      'label' => '浜町2',
      'area' => '10',
      'shop' => '0262',
      'pot' => '08059046995',
      'sheet' => '浜町店 北スポット',
    ],
  ];
}

function current_pickup_date() {
  return date('Ymd');
}

function requested_slot() {
  $slot = trim((string)($_GET['slot'] ?? $_POST['slot'] ?? ''));
  if (in_array($slot, ['09', '9', '0900', '09-13'], true)) return '09';
  if (in_array($slot, ['14', '1400', '14-16'], true)) return '14';
  if (in_array($slot, ['16', '1600', '16-18'], true)) return '16';
  if ($slot === 'all') return 'all';
  return 'all';
}

function slot_label($slot) {
  if ($slot === '09') return '09時〜13時';
  if ($slot === '14') return '14時〜16時';
  if ($slot === '16') return '16時〜18時';
  return '全時間帯';
}

function normalize_time_key($value) {
  $s = strtr((string)$value, [
    '０' => '0', '１' => '1', '２' => '2', '３' => '3', '４' => '4',
    '５' => '5', '６' => '6', '７' => '7', '８' => '8', '９' => '9',
    '〜' => '~', '～' => '~', '－' => '-', 'ー' => '-', '−' => '-',
    '　' => '', ' ' => '',
  ]);
  return $s;
}

function slot_matches($time, $slot) {
  if ($slot === 'all') return true;
  $key = normalize_time_key($time);
  if ($slot === '09') return strpos($key, '09時~13時') !== false || strpos($key, '9時~13時') !== false;
  if ($slot === '14') return strpos($key, '14時~16時') !== false;
  if ($slot === '16') return strpos($key, '16時~18時') !== false;
  return false;
}

function http_request($url, $method = 'GET', $body = null, $cookieFile = null) {
  $ch = curl_init($url);
  $headers = [
    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language: ja,en;q=0.9',
  ];
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  ]);
  if ($cookieFile) {
    curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
    curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
  }
  if ($method === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  }
  $response = curl_exec($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
  curl_close($ch);
  return [
    'body' => $response,
    'httpCode' => $httpCode,
    'curlErr' => $curlErr,
    'finalUrl' => $finalUrl,
  ];
}

function html_to_lines($html) {
  $text = preg_replace('/<\s*br\s*\/?\s*>/iu', "\n", (string)$html);
  $text = preg_replace('/<\s*\/\s*(div|p|li|tr|h[1-6])\s*>/iu', "\n", $text);
  $text = html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
  $rawLines = preg_split('/\R/u', $text);
  $lines = [];
  foreach ($rawLines as $line) {
    $line = trim(preg_replace('/[ \t　]+/u', ' ', $line));
    if ($line !== '') $lines[] = $line;
  }
  return $lines;
}

function strip_label($line, $label) {
  $line = preg_replace('/^[├└│|｜\s]+/u', '', $line);
  return trim(preg_replace('/^' . preg_quote($label, '/') . '\s*[:：]\s*/u', '', $line));
}

function normalize_address($value) {
  $v = trim((string)$value);
  $v = preg_replace('/^〒\s*\d{3}[-‐－ー−]?\d{4}\s*/u', '', $v);
  return trim($v);
}

function pickup_id($date, $target, $company, $time, $address, $phone) {
  return substr(hash('sha256', implode('|', [
    $date,
    $target['label'],
    $company,
    normalize_time_key($time),
    normalize_time_key($address),
    normalize_time_key($phone),
  ])), 0, 20);
}

function parse_pickups($html, $slot, $date, $target) {
  $lines = html_to_lines($html);
  $items = [];
  $current = null;
  $pendingField = '';

  foreach ($lines as $line) {
    if (preg_match('/^■\s*(.+)$/u', $line, $m)) {
      if ($current) $items[] = $current;
      $current = [
        'company' => trim($m[1]),
        'status' => '',
        'time' => '',
        'address' => '',
        'phone' => '',
      ];
      $pendingField = '';
      continue;
    }
    if (!$current) continue;

    if ($pendingField === 'time') {
      $value = trim(preg_replace('/^[├└│|｜\s]+/u', '', $line));
      if ($value !== '' && strpos($value, '住所') === false && strpos($value, '登録電話番号') === false) {
        $current['time'] = $value;
        $pendingField = '';
        continue;
      }
      $pendingField = '';
    }

    if (strpos($line, '希望時間帯') !== false) {
      $time = strip_label($line, '希望時間帯');
      if ($time !== '') {
        $current['time'] = $time;
      } else {
        $pendingField = 'time';
      }
    } elseif (strpos($line, '集荷依頼') !== false) {
      $current['status'] = '集荷依頼';
    } elseif (strpos($line, '集荷キャンセル') !== false) {
      $current['status'] = '集荷キャンセル';
    } elseif (strpos($line, '住所') !== false) {
      $current['address'] = normalize_address(strip_label($line, '住所'));
    } elseif (strpos($line, '登録電話番号') !== false) {
      $current['phone'] = strip_label($line, '登録電話番号');
    }
  }
  if ($current) $items[] = $current;

  $filtered = [];
  foreach ($items as $item) {
    $status = (string)($item['status'] ?? '');
    if (!in_array($status, ['集荷依頼', '集荷キャンセル'], true)) continue;
    if ($item['company'] === '' || $item['time'] === '' || $item['address'] === '' || $item['phone'] === '') continue;
    if (!slot_matches($item['time'], $slot)) continue;
    $item['id'] = pickup_id($date, $target, $item['company'], $item['time'], $item['address'], $item['phone']);
    $item['date'] = $date;
    $item['source'] = 'ecohai-spot';
    $item['cancelled'] = $status === '集荷キャンセル';
    $item['pot_label'] = $target['label'];
    $item['pot'] = $target['pot'];
    $item['spot_sheet'] = $target['sheet'];
    $item['slot'] = $slot;
    $filtered[] = $item;
  }
  return $filtered;
}

function cache_path() {
  return dirname(__DIR__) . '/data/spot_pickups_cache.json';
}

function read_cache($path) {
  if (!file_exists($path)) return ['date' => '', 'items' => []];
  $data = json_decode((string)file_get_contents($path), true);
  if (!is_array($data)) return ['date' => '', 'items' => []];
  if (!isset($data['items']) || !is_array($data['items'])) $data['items'] = [];
  return $data;
}

function write_cache($path, $cache) {
  $dir = dirname($path);
  if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    throw new RuntimeException('キャッシュ保存先を作成できません');
  }
  $json = json_encode($cache, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if (file_put_contents($path, $json, LOCK_EX) === false) {
    throw new RuntimeException('キャッシュを書き込めません');
  }
}

function sync_spot_pickup_sheet($items, $date, $sheetName) {
  $webappUrl = cfg('PICKUP_PROGRESS_WEBAPP_URL');
  $secret = cfg('PICKUP_PROGRESS_SECRET');
  if ($webappUrl === '' || $webappUrl === 'https://script.google.com/macros/s/.../exec' ||
      $secret === '' || $secret === 'change-this-secret') {
    return [
      'ok' => false,
      'skipped' => true,
      'reason' => 'PICKUP_PROGRESS_WEBAPP_URL または PICKUP_PROGRESS_SECRET が未設定です',
    ];
  }

  $payloadItems = [];
  foreach ($items as $item) {
    if (!is_array($item)) continue;
    $phone = (string)($item['phone'] ?? '');
    $time = (string)($item['time'] ?? '');
    $cancelled = !empty($item['cancelled']);
    $payloadItems[] = [
      'id' => (string)($item['id'] ?? ''),
      'company' => (string)($item['company'] ?? ''),
      'address' => (string)($item['address'] ?? ''),
      'time' => $time,
      'method' => $cancelled ? 'キャンセル' : 'スポット',
      'notes' => trim(implode("\n", array_filter([
        $cancelled ? 'スポット集荷キャンセル' : 'スポット集荷',
        $time !== '' ? '希望時間帯: ' . $time : '',
        $phone !== '' ? '登録電話番号: ' . $phone : '',
      ]))),
      'phone' => $phone,
      'date' => (string)($item['date'] ?? $date),
      'source' => 'ecohai-spot',
      'spot_sheet' => (string)($item['spot_sheet'] ?? $sheetName),
      'cancelled' => $cancelled,
      'collected' => $cancelled,
      'collected_at' => $cancelled ? date('c') : '',
      'collected_by' => $cancelled ? 'キャンセル' : '',
    ];
  }

  $ch = curl_init($webappUrl);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json; charset=utf-8'],
    CURLOPT_POSTFIELDS => json_encode([
      'action' => 'spotPickupsSync',
      'secret' => $secret,
      'sheet' => $sheetName,
      'date' => $date,
      'items' => $payloadItems,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
  ]);
  $response = curl_exec($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlErr = curl_error($ch);
  curl_close($ch);

  if ($response === false || $httpCode < 200 || $httpCode >= 300) {
    return [
      'ok' => false,
      'skipped' => false,
      'error' => $curlErr ?: ('HTTP ' . $httpCode),
    ];
  }
  $data = json_decode((string)$response, true);
  if (!is_array($data) || empty($data['ok'])) {
    return [
      'ok' => false,
      'skipped' => false,
      'error' => is_array($data) && isset($data['error']) ? (string)$data['error'] : substr((string)$response, 0, 300),
    ];
  }
  return [
    'ok' => true,
    'sheet' => $sheetName,
    'count' => (int)($data['count'] ?? count($payloadItems)),
  ];
}

$date = current_pickup_date();
$slot = requested_slot();
$targets = spot_pickup_targets();
$cookieFile = tempnam(sys_get_temp_dir(), 'ecohai_cookie_');

try {
  http_request('https://driver.ecohai.co.jp/ecohai-kun/Login', 'GET', null, $cookieFile);
  $login = http_request(
    'https://driver.ecohai.co.jp/ecohai-kun/',
    'POST',
    http_build_query(['user_id' => $userId, 'user_pw' => $userPass]),
    $cookieFile
  );
  if ($login['body'] === false || $login['httpCode'] < 200 || $login['httpCode'] >= 400) {
    http_response_code(502);
    echo json_encode(['error' => 'エコ配ログインに失敗しました', 'detail' => $login['curlErr'] ?: ('HTTP ' . $login['httpCode'])], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $items = [];
  $fetchResults = [];
  foreach ($targets as $target) {
    $pickupUrl = sprintf(
      'https://driver.ecohai.co.jp/ecohai-kun/Pickup/view/%s/%s/%s/%s/%s',
      rawurlencode($date),
      rawurlencode($target['pot']),
      rawurlencode($target['area']),
      rawurlencode($target['shop']),
      rawurlencode($target['pot'])
    );
    $page = http_request($pickupUrl, 'GET', null, $cookieFile);
    if ($page['body'] === false || $page['httpCode'] < 200 || $page['httpCode'] >= 400) {
      $fetchResults[] = [
        'target' => $target,
        'fetched' => 0,
        'error' => 'エコ配の集荷ページを取得できませんでした',
        'detail' => $page['curlErr'] ?: ('HTTP ' . $page['httpCode']),
      ];
      continue;
    }
    if (strpos((string)$page['body'], 'USER ID') !== false && strpos((string)$page['body'], 'USER PASS') !== false) {
      $fetchResults[] = [
        'target' => $target,
        'fetched' => 0,
        'error' => 'エコ配ログイン後のセッションを取得できませんでした',
      ];
      continue;
    }

    $targetItems = parse_pickups((string)$page['body'], $slot, $date, $target);
    $items = array_merge($items, $targetItems);
    $fetchResults[] = [
      'target' => $target,
      'fetched' => count($targetItems),
    ];
  }
  $path = cache_path();
  $cache = read_cache($path);
  if (($cache['date'] ?? '') !== $date) {
    $cache = ['date' => $date, 'items' => []];
  }

  $byId = [];
  foreach ($cache['items'] as $old) {
    if (is_array($old) && isset($old['id'])) $byId[(string)$old['id']] = $old;
  }
  foreach ($items as $item) {
    $byId[(string)$item['id']] = $item;
  }

  $cache = [
    'date' => $date,
    'updated_at' => date('c'),
    'targets' => $targets,
    'last_slot' => $slot,
    'last_slot_label' => slot_label($slot),
    'items' => array_values($byId),
  ];
  write_cache($path, $cache);
  $itemsBySheet = [];
  foreach ($cache['items'] as $item) {
    if (!is_array($item)) continue;
    $sheetName = (string)($item['spot_sheet'] ?? '');
    if ($sheetName === '') continue;
    if (!isset($itemsBySheet[$sheetName])) $itemsBySheet[$sheetName] = [];
    $itemsBySheet[$sheetName][] = $item;
  }
  $sheetSync = [];
  foreach ($itemsBySheet as $sheetName => $sheetItems) {
    $sheetSync[$sheetName] = sync_spot_pickup_sheet($sheetItems, $date, $sheetName);
  }

  echo json_encode([
    'ok' => true,
    'date' => $date,
    'slot' => $slot,
    'slot_label' => slot_label($slot),
    'targets' => $targets,
    'fetch_results' => $fetchResults,
    'fetched' => count($items),
    'cached' => count($cache['items']),
    'sheet_sync' => $sheetSync,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
  http_response_code(500);
  echo json_encode(['error' => 'スポット集荷取得に失敗しました', 'detail' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} finally {
  if ($cookieFile && file_exists($cookieFile)) @unlink($cookieFile);
}
