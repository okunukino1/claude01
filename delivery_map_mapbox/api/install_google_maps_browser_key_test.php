<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
  header('Allow: POST');
  http_response_code(405);
  echo json_encode(['error' => 'POSTで送信してください'], JSON_UNESCAPED_UNICODE);
  exit;
}

require_once __DIR__ . '/request_guard.php';
delivery_app_reject_disallowed_browser_origin();

$expectedTokenHash = '07873c098ff53a341e895da2500e7854ddd4f535fdfdd55b05fbbc22a0b75564';
$givenToken = trim((string)($_SERVER['HTTP_X_SETUP_TOKEN'] ?? ''));
if ($givenToken === '' || !hash_equals($expectedTokenHash, hash('sha256', $givenToken))) {
  http_response_code(403);
  echo json_encode(['error' => '設定トークンが正しくありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$payload = json_decode((string)file_get_contents('php://input'), true);
$key = is_array($payload) ? trim((string)($payload['googleMapsBrowserKey'] ?? '')) : '';
if (preg_match('/^AIza[0-9A-Za-z_-]{35}$/D', $key) !== 1) {
  http_response_code(400);
  echo json_encode(['error' => 'ブラウザーキーの形式が正しくありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$target = __DIR__ . '/google_maps_browser_key_test.runtime.php';
if (is_file($target)) {
  http_response_code(409);
  echo json_encode(['error' => 'ブラウザーキーは設定済みです'], JSON_UNESCAPED_UNICODE);
  exit;
}

$temporary = $target . '.tmp-' . bin2hex(random_bytes(8));
$contents = "<?php\nreturn " . var_export($key, true) . ";\n";
if (file_put_contents($temporary, $contents, LOCK_EX) === false) {
  http_response_code(500);
  echo json_encode(['error' => '一時設定を書き込めません'], JSON_UNESCAPED_UNICODE);
  exit;
}
@chmod($temporary, 0600);
if (!rename($temporary, $target)) {
  @unlink($temporary);
  http_response_code(500);
  echo json_encode(['error' => '設定を確定できません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$installerRemoved = @unlink(__FILE__);
echo json_encode([
  'configured' => true,
  'installerRemoved' => $installerRemoved,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
