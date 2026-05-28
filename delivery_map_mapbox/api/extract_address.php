<?php
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POSTのみ対応しています'], JSON_UNESCAPED_UNICODE);
  exit;
}

$configFile = __DIR__ . '/config.php';
if (!file_exists($configFile)) {
  http_response_code(500);
  echo json_encode(['error' => 'サーバー設定ファイルがありません', 'hint' => 'api/config.sample.php を api/config.php にコピーし、GEMINI_API_KEYを設定してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

if (!defined('GEMINI_API_KEY') || !GEMINI_API_KEY || GEMINI_API_KEY === 'AIza...ここにAPIキーを入れる...') {
  http_response_code(500);
  echo json_encode(['error' => 'Gemini APIキーが未設定です', 'hint' => 'api/config.php の GEMINI_API_KEY を設定してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

$model = defined('GEMINI_MODEL') && GEMINI_MODEL ? GEMINI_MODEL : 'gemini-2.5-flash-lite';
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

$image = $input['image'] ?? '';
$mimeType = $input['mimeType'] ?? 'image/jpeg';
if (!$image || !preg_match('/^[A-Za-z0-9+\/\r\n=]+$/', $image)) {
  http_response_code(400);
  echo json_encode(['error' => '画像データが不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
if (strlen($image) > 8 * 1024 * 1024) {
  http_response_code(413);
  echo json_encode(['error' => '画像が大きすぎます', 'hint' => '撮影画像を小さくするか、index.html側の圧縮サイズを下げてください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

$prompt = <<<TXT
この画像は日本の配送伝票またはラベルです。お届け先(受取人)の住所だけを抽出してください。

重要:
- 送り主住所ではなく、お届け先・受取人・配送先の住所を優先してください。
- 郵便番号が読める場合は住所に含めてください。
- 建物名、階数、部屋番号が読める場合はnoteへ入れてください。
- 宛名が読める場合はrecipientへ入れてください。
- 不明な文字は無理に推測しないでください。

回答は必ずJSONのみで返してください。説明文や余計なテキストは禁止です。
住所が読めた場合:
{"address":"〒XXX-XXXX 東京都...", "recipient":"宛名(あれば、なければ空文字)", "note":"建物名・階数・部屋番号など補足(あれば)", "confidence":"high または medium または low"}

注意:
- addressには郵便番号・市区町村・番地までを中心に入れてください。
- 建物名、部屋番号、宛名はaddressに混ぜず、noteまたはrecipientへ分けてください。
- 例: 〒212-0002 神奈川県 川崎市幸区塚越 3-484-1 ラグゼコート C-413 奥貫様
  → address: 〒212-0002 神奈川県川崎市幸区塚越3-484-1
  → note: ラグゼコート C-413
  → recipient: 奥貫一成

住所が読み取れない場合:
{"error":"理由を簡潔に", "confidence":"low"}
TXT;

$requestBody = [
  'contents' => [[
    'role' => 'user',
    'parts' => [
      ['inline_data' => ['mime_type' => $mimeType, 'data' => $image]],
      ['text' => $prompt]
    ]
  ]],
  'generationConfig' => [
    'temperature' => 0,
    'maxOutputTokens' => 256,
    'responseMimeType' => 'application/json'
  ]
];

$url = 'https://generativelanguage.googleapis.com/v1beta/models/' . rawurlencode($model) . ':generateContent';
$ch = curl_init($url);
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-goog-api-key: ' . GEMINI_API_KEY],
  CURLOPT_POSTFIELDS => json_encode($requestBody, JSON_UNESCAPED_UNICODE),
  CURLOPT_CONNECTTIMEOUT => 10,
  CURLOPT_TIMEOUT => 45
]);
$response = curl_exec($ch);
$curlErr = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($response === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Gemini APIへの接続に失敗しました', 'detail' => $curlErr, 'hint' => 'サーバーから外部HTTPS通信が可能か確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
$data = json_decode($response, true);
if ($httpCode < 200 || $httpCode >= 300) {
  $message = $data['error']['message'] ?? substr($response, 0, 500);
  $hint = 'APIキー、課金設定、プリペイド残高、モデル名を確認してください。';
  if ($httpCode == 429 && strpos($message, 'prepayment credits are depleted') !== false) {
    $hint = 'Google AI Studioで対象プロジェクトのプリペイドクレジットを追加してください。APIキーのプロジェクトと課金プロジェクトが同じかも確認してください。';
  }
  http_response_code($httpCode);
  echo json_encode(['error' => 'Gemini API応答エラー [HTTP ' . $httpCode . ']', 'detail' => $message, 'hint' => $hint], JSON_UNESCAPED_UNICODE);
  exit;
}

$text = '';
if (isset($data['candidates'][0]['content']['parts']) && is_array($data['candidates'][0]['content']['parts'])) {
  foreach ($data['candidates'][0]['content']['parts'] as $part) {
    if (isset($part['text'])) $text .= $part['text'];
  }
}
$text = trim($text);
if ($text === '') {
  http_response_code(502);
  echo json_encode(['error' => 'Geminiの応答が空です', 'detail' => substr($response, 0, 800)], JSON_UNESCAPED_UNICODE);
  exit;
}
if (!preg_match('/\{[\s\S]*\}/', $text, $m)) {
  http_response_code(502);
  echo json_encode(['error' => 'Gemini応答からJSONを取得できませんでした', 'detail' => substr($text, 0, 500)], JSON_UNESCAPED_UNICODE);
  exit;
}
$result = json_decode($m[0], true);
if (!is_array($result)) {
  http_response_code(502);
  echo json_encode(['error' => 'Gemini応答JSONの解析に失敗しました', 'detail' => substr($m[0], 0, 500)], JSON_UNESCAPED_UNICODE);
  exit;
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
