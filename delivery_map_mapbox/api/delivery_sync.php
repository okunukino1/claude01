<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(503);
  echo json_encode(['error' => 'DB設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
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

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

const SYNC_PAYLOAD_MAX_BYTES = 524288; // 512 KB

function sync_table() {
  $table = defined('DELIVERY_SYNC_TEST_DB_TABLE')
    ? (string)DELIVERY_SYNC_TEST_DB_TABLE
    : 'delivery_sync_rooms_test';
  if (!preg_match('/^[A-Za-z0-9_]+$/', $table)) {
    throw new RuntimeException('テーブル名が不正です');
  }
  return $table;
}

function sync_pdo() {
  foreach (['GEOCODE_CACHE_TEST_DB_HOST', 'GEOCODE_CACHE_TEST_DB_NAME',
            'GEOCODE_CACHE_TEST_DB_USER', 'GEOCODE_CACHE_TEST_DB_PASSWORD'] as $name) {
    if (!defined($name) || (string)constant($name) === '') {
      throw new RuntimeException('DB接続情報が未設定です: ' . $name);
    }
  }
  if (!extension_loaded('pdo_mysql')) {
    throw new RuntimeException('サーバーの PHP で pdo_mysql が有効ではありません');
  }
  $host    = (string)GEOCODE_CACHE_TEST_DB_HOST;
  $db      = (string)GEOCODE_CACHE_TEST_DB_NAME;
  $user    = (string)GEOCODE_CACHE_TEST_DB_USER;
  $pass    = (string)GEOCODE_CACHE_TEST_DB_PASSWORD;
  $port    = defined('GEOCODE_CACHE_TEST_DB_PORT') ? (int)GEOCODE_CACHE_TEST_DB_PORT : 3306;
  $dsn     = "mysql:host={$host};port={$port};dbname={$db};charset=utf8mb4";
  return new PDO($dsn, $user, $pass, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
}

function ensure_sync_table($pdo, $table) {
  $pdo->exec("
    CREATE TABLE IF NOT EXISTS `{$table}` (
      `room_code`  CHAR(64)     NOT NULL,
      `payload`    MEDIUMTEXT   NOT NULL DEFAULT '',
      `device_id`  VARCHAR(64)  NOT NULL DEFAULT '',
      `updated_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`room_code`),
      KEY `idx_updated_at` (`updated_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  ");
}

function hash_room_code($raw) {
  $raw = trim((string)$raw);
  if ($raw === '' || mb_strlen($raw, 'UTF-8') > 200) return '';
  return hash('sha256', 'delivery_sync_v1:' . $raw);
}

function sanitize_device_id($raw) {
  $id = preg_replace('/[^A-Za-z0-9\-_]/', '', (string)$raw);
  return substr($id, 0, 64);
}

// ---- Parse common fields ----
$action   = trim((string)($input['action']    ?? ''));
$roomCode = hash_room_code($input['code']     ?? '');
$deviceId = sanitize_device_id($input['device_id'] ?? '');

if ($roomCode === '') {
  http_response_code(400);
  echo json_encode(['error' => '共有コードが不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

try {
  $pdo   = sync_pdo();
  $table = sync_table();
  ensure_sync_table($pdo, $table);

  // ------------------------------------------------------------------
  // pull — fetch latest payload for the room
  // ------------------------------------------------------------------
  if ($action === 'pull') {
    $stmt = $pdo->prepare(
      "SELECT `payload`, `device_id`, `updated_at` FROM `{$table}` WHERE `room_code` = ?"
    );
    $stmt->execute([$roomCode]);
    $row = $stmt->fetch();

    if (!$row) {
      echo json_encode([
        'ok'         => true,
        'found'      => false,
        'updated_at' => '',
      ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }

    echo json_encode([
      'ok'         => true,
      'found'      => true,
      'payload'    => $row['payload'],
      'device_id'  => $row['device_id'],
      'updated_at' => $row['updated_at'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  // ------------------------------------------------------------------
  // push — store payload for the room
  // ------------------------------------------------------------------
  if ($action === 'push') {
    $payload = (string)($input['payload'] ?? '');
    if (strlen($payload) > SYNC_PAYLOAD_MAX_BYTES) {
      http_response_code(413);
      echo json_encode([
        'error' => 'データが大きすぎます（512KB以下にしてください）',
      ], JSON_UNESCAPED_UNICODE);
      exit;
    }

    $pdo->prepare("
      INSERT INTO `{$table}` (`room_code`, `payload`, `device_id`, `updated_at`)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        `payload`    = VALUES(`payload`),
        `device_id`  = VALUES(`device_id`),
        `updated_at` = NOW()
    ")->execute([$roomCode, $payload, $deviceId]);

    $row = $pdo->prepare(
      "SELECT `updated_at` FROM `{$table}` WHERE `room_code` = ?"
    );
    $row->execute([$roomCode]);
    $updated = ($row->fetch())['updated_at'] ?? '';

    echo json_encode([
      'ok'         => true,
      'updated_at' => $updated,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  // ------------------------------------------------------------------
  // delete_room — remove this device's room (cleanup)
  // ------------------------------------------------------------------
  if ($action === 'delete_room') {
    $stmt = $pdo->prepare(
      "DELETE FROM `{$table}` WHERE `room_code` = ? AND `device_id` = ?"
    );
    $stmt->execute([$roomCode, $deviceId]);
    echo json_encode([
      'ok'      => true,
      'deleted' => $stmt->rowCount(),
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }

  http_response_code(400);
  echo json_encode(['error' => '未対応の操作です'], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
  http_response_code(503);
  echo json_encode([
    'error'  => 'データ共有処理に失敗しました',
    'detail' => $e->getMessage(),
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
