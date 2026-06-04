<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$apiStartedAt = microtime(true);

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(503);
  echo json_encode(['error' => 'テストDB設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/request_guard.php';
delivery_app_require_same_origin_request();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

function api_started_at() {
  global $apiStartedAt;
  return $apiStartedAt;
}

function response_elapsed_ms() {
  return (int)round((microtime(true) - api_started_at()) * 1000);
}

function mysql_cache_table() {
  $table = defined('GEOCODE_CACHE_TEST_DB_TABLE') ? (string)GEOCODE_CACHE_TEST_DB_TABLE : 'delivery_geocode_cache_test';
  if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
    throw new RuntimeException('テストDBテーブル名が不正です');
  }
  return $table;
}

function mysql_cache_max_items() {
  $max = defined('GEOCODE_CACHE_TEST_DB_MAX_ITEMS') ? (int)GEOCODE_CACHE_TEST_DB_MAX_ITEMS : 50000;
  return max(1000, min($max, 500000));
}

function mysql_cache_pdo() {
  foreach (['GEOCODE_CACHE_TEST_DB_HOST', 'GEOCODE_CACHE_TEST_DB_NAME', 'GEOCODE_CACHE_TEST_DB_USER', 'GEOCODE_CACHE_TEST_DB_PASSWORD'] as $name) {
    if (!defined($name) || (string)constant($name) === '') {
      throw new RuntimeException('テストDB接続情報が未設定です: ' . $name);
    }
  }

  if (!extension_loaded('pdo_mysql')) {
    throw new RuntimeException('サーバーのPHPで pdo_mysql が有効ではありません');
  }

  $host = (string)GEOCODE_CACHE_TEST_DB_HOST;
  $db = (string)GEOCODE_CACHE_TEST_DB_NAME;
  $user = (string)GEOCODE_CACHE_TEST_DB_USER;
  $pass = (string)GEOCODE_CACHE_TEST_DB_PASSWORD;
  $port = defined('GEOCODE_CACHE_TEST_DB_PORT') ? (int)GEOCODE_CACHE_TEST_DB_PORT : 3306;
  $charset = 'utf8mb4';
  $dsn = "mysql:host={$host};port={$port};dbname={$db};charset={$charset}";

  return new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
  ]);
}

function ensure_mysql_cache_table($pdo, $table) {
  $sql = "
    CREATE TABLE IF NOT EXISTS `{$table}` (
      `cache_key` CHAR(64) NOT NULL,
      `address` VARCHAR(300) NOT NULL DEFAULT '',
      `lat` DECIMAL(10,7) NOT NULL,
      `lng` DECIMAL(10,7) NOT NULL,
      `approx` TINYINT(1) NOT NULL DEFAULT 0,
      `formatted` VARCHAR(300) NOT NULL DEFAULT '',
      `hit_count` INT UNSIGNED NOT NULL DEFAULT 0,
      `saved_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      `last_used_at` TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (`cache_key`),
      KEY `idx_last_used_at` (`last_used_at`),
      KEY `idx_updated_at` (`updated_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ";
  $pdo->exec($sql);
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

function prune_mysql_cache($pdo, $table) {
  $max = mysql_cache_max_items();
  $count = (int)$pdo->query("SELECT COUNT(*) FROM `{$table}`")->fetchColumn();
  if ($count <= $max) return;

  $deleteCount = $count - $max;
  $sql = "
    DELETE FROM `{$table}`
    WHERE `cache_key` IN (
      SELECT `cache_key` FROM (
        SELECT `cache_key`
        FROM `{$table}`
        ORDER BY COALESCE(`last_used_at`, `updated_at`, `saved_at`) ASC
        LIMIT {$deleteCount}
      ) AS old_rows
    )
  ";
  $pdo->exec($sql);
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
  $pdo = mysql_cache_pdo();
  $table = mysql_cache_table();
  ensure_mysql_cache_table($pdo, $table);

  if ($action === 'lookup') {
    $stmt = $pdo->prepare("SELECT `lat`, `lng`, `approx`, `formatted`, `hit_count` FROM `{$table}` WHERE `cache_key` = ?");
    $stmt->execute([$key]);
    $item = $stmt->fetch();
    if (!$item) {
      echo json_encode(['hit' => false, 'backend' => 'mysql', 'elapsed_ms' => response_elapsed_ms()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }

    $lat = finite_float($item['lat'] ?? null);
    $lng = finite_float($item['lng'] ?? null);
    if ($lat === null || $lng === null) {
      $delete = $pdo->prepare("DELETE FROM `{$table}` WHERE `cache_key` = ?");
      $delete->execute([$key]);
      echo json_encode(['hit' => false, 'backend' => 'mysql', 'elapsed_ms' => response_elapsed_ms()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }

    $hitCount = (int)($item['hit_count'] ?? 0) + 1;
    $update = $pdo->prepare("UPDATE `{$table}` SET `hit_count` = `hit_count` + 1, `last_used_at` = NOW() WHERE `cache_key` = ?");
    $update->execute([$key]);

    echo json_encode([
      'hit' => true,
      'backend' => 'mysql',
      'elapsed_ms' => response_elapsed_ms(),
      'lat' => $lat,
      'lng' => $lng,
      'approx' => !empty($item['approx']),
      'formatted' => (string)($item['formatted'] ?? ''),
      'hit_count' => $hitCount,
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

    $sql = "
      INSERT INTO `{$table}` (`cache_key`, `address`, `lat`, `lng`, `approx`, `formatted`, `hit_count`, `saved_at`, `updated_at`, `last_used_at`)
      VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        `address` = VALUES(`address`),
        `lat` = VALUES(`lat`),
        `lng` = VALUES(`lng`),
        `approx` = VALUES(`approx`),
        `formatted` = VALUES(`formatted`),
        `updated_at` = NOW(),
        `last_used_at` = NOW()
    ";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$key, $address, $lat, $lng, !empty($input['approx']) ? 1 : 0, $formatted]);

    if (random_int(1, 20) === 1) {
      prune_mysql_cache($pdo, $table);
    }

    echo json_encode(['ok' => true, 'backend' => 'mysql', 'elapsed_ms' => response_elapsed_ms()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  http_response_code(400);
  echo json_encode(['error' => '未対応の操作です'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
  http_response_code(503);
  echo json_encode([
    'error' => 'テストDBキャッシュ処理に失敗しました',
    'detail' => $e->getMessage(),
    'backend' => 'mysql',
    'elapsed_ms' => response_elapsed_ms(),
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
