<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;
require_once __DIR__ . '/request_guard.php';
require_once __DIR__ . '/push_common.php';

delivery_app_require_same_origin_request();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

function spot_completed_state_path() {
  return push_private_dir() . '/push_spot_completed_state.json';
}

function spot_completed_read_state() {
  $state = push_storage_read(spot_completed_state_path(), ['sent_keys' => []]);
  if (!isset($state['sent_keys']) || !is_array($state['sent_keys'])) $state['sent_keys'] = [];
  return $state;
}

function spot_completed_write_state($state) {
  if (!isset($state['sent_keys']) || !is_array($state['sent_keys'])) $state['sent_keys'] = [];
  if (count($state['sent_keys']) > 5000) {
    uasort($state['sent_keys'], function($a, $b) { return strcmp((string)$a, (string)$b); });
    $state['sent_keys'] = array_slice($state['sent_keys'], -5000, null, true);
  }
  push_storage_write(spot_completed_state_path(), $state);
}

function spot_completed_trim($value, $max = 120) {
  $s = trim((string)$value);
  if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
  return substr($s, 0, $max);
}

try {
  if (!push_is_configured()) {
    http_response_code(503);
    echo json_encode(['error' => '通知サーバー設定が未完了です'], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $input = json_decode((string)file_get_contents('php://input'), true);
  if (!is_array($input)) throw new InvalidArgumentException('送信データが正しくありません');

  $course = spot_completed_trim($input['course'] ?? '', 60);
  $courses = push_filter_courses([$course]);
  if (count($courses) === 0) {
    http_response_code(400);
    echo json_encode(['error' => '通知対象コースが不正です'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $course = $courses[0];

  $company = spot_completed_trim($input['company'] ?? '', 80);
  if ($company === '') $company = 'スポット集荷';
  $timeCode = spot_completed_trim($input['time_code'] ?? '', 20);
  $pickupTime = spot_completed_trim($input['pickup_time'] ?? '', 80);
  if ($pickupTime === '') $pickupTime = $timeCode;
  $completedBy = spot_completed_trim($input['completed_by'] ?? '', 60);
  $date = preg_replace('/\D/', '', (string)($input['spot_pickup_date'] ?? ''));
  $date = substr($date, 0, 8);
  if ($date === '') $date = date('Ymd');

  $identity = spot_completed_trim($input['spot_pickup_id'] ?? '', 160);
  if ($identity === '') $identity = spot_completed_trim($input['natural_key'] ?? '', 240);
  if ($identity === '') $identity = spot_completed_trim(($input['address'] ?? '') . '|' . $company . '|' . $timeCode, 240);
  if ($identity === '') throw new InvalidArgumentException('スポット集荷IDが不正です');

  $key = hash('sha256', implode('|', ['completed', $date, $course, $identity]));
  $state = spot_completed_read_state();
  if (isset($state['sent_keys'][$key])) {
    echo json_encode(['ok' => true, 'duplicate' => true, 'sent' => 0], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }

  $bodyParts = array_values(array_filter([$company, $pickupTime, $completedBy], function($v) {
    return trim((string)$v) !== '';
  }));
  $event = [
    'key' => $key,
    'course' => $course,
    'title' => $course . '/' . $company . '/ 集荷済み',
    'body' => implode(' / ', $bodyParts),
    'recipients' => null,
    'delivered' => [],
  ];

  $subscriptionData = push_read_subscriptions();
  $result = push_send_event($event, $subscriptionData);
  push_storage_write(push_subscriptions_path(), $subscriptionData);

  if (!empty($result['complete']) || (int)($result['sent'] ?? 0) > 0) {
    $state['sent_keys'][$key] = date('c');
    spot_completed_write_state($state);
  }

  echo json_encode([
    'ok' => true,
    'sent' => (int)($result['sent'] ?? 0),
    'failed' => (int)($result['failed'] ?? 0),
    'course' => $course,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
  http_response_code(400);
  echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
