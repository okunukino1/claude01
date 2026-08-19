<?php

require_once __DIR__ . '/../delivery_map_mapbox/api/extract_address_test_support.php';
require_once __DIR__ . '/../delivery_map_mapbox/api/extract_address_vision_test_support.php';
require_once __DIR__ . '/../delivery_map_mapbox/api/extract_address_hybrid_test_support.php';

function assert_hybrid_same($expected, $actual, $label) {
  if ($expected === $actual) return;
  fwrite(STDERR, $label . "\nexpected: " . json_encode($expected, JSON_UNESCAPED_UNICODE) . "\nactual:   " . json_encode($actual, JSON_UNESCAPED_UNICODE) . "\n");
  exit(1);
}

$vision = [
  'ok' => true,
  'has_text' => true,
  'text' => "お届け先\n〒103-0015\n東京都中央区日本橋箱崎町43-\n5\nスクエア日本橋\n102号室\nご依頼主\n〒103-0014\n東京都中央区日本橋蛎殻町1-2-3",
  'postal_codes' => ['103-0015', '103-0014'],
  'address_candidates' => [
    '東京都中央区日本橋箱崎町43-5',
    '東京都中央区日本橋蛎殻町1-2-3'
  ],
  'room_candidates' => ['102'],
  'confidence' => 0.96
];

$prompt = delivery_test_hybrid_prompt($vision);
assert_hybrid_same(true, strpos($prompt, '先頭候補を自動採用せず') !== false, 'prompt rejects first-candidate shortcut');
assert_hybrid_same(true, strpos($prompt, '日本橋箱崎町43-') !== false, 'prompt contains Vision text');
assert_hybrid_same(true, strpos($prompt, '日本橋蛎殻町1-2-3') !== false, 'prompt contains sender candidate');

$summary = delivery_test_hybrid_vision_summary($vision, 731);
assert_hybrid_same('success', $summary['state'], 'summary state');
assert_hybrid_same(731, $summary['elapsed_ms'], 'summary elapsed');
assert_hybrid_same(false, array_key_exists('text', $summary), 'summary never exposes raw OCR text');

$usable = delivery_test_normalize_ocr_result([
  'address' => '〒103-0015 東京都中央区日本橋箱崎町43-5',
  'address_lines' => ['〒103-0015', '東京都中央区日本橋箱崎町43-', '5'],
  'postal_code' => '103-0015',
  'sender_address' => '〒103-0014 東京都中央区日本橋蛎殻町1-2-3',
  'recipient' => 'テスト様',
  'building' => 'スクエア日本橋',
  'room' => '102',
  'note' => '',
  'confidence' => 'high',
  'error' => '',
  'rotation_hint' => 0
]);
$reason = '';
assert_hybrid_same(true, delivery_test_hybrid_result_is_usable($usable, $vision, $reason), 'usable recipient result');
assert_hybrid_same('', $reason, 'usable result reason');

$lowConfidence = $usable;
$lowConfidence['confidence'] = 'low';
assert_hybrid_same(false, delivery_test_hybrid_result_is_usable($lowConfidence, $vision, $reason), 'low-confidence fallback');
assert_hybrid_same('selector_low_confidence', $reason, 'low-confidence reason');

$postalConflict = $usable;
$postalConflict['address'] = '〒144-0051 東京都大田区西蒲田1-2-3';
$postalConflict['postal_code'] = '144-0051';
assert_hybrid_same(false, delivery_test_hybrid_result_is_usable($postalConflict, $vision, $reason), 'postal conflict fallback');
assert_hybrid_same('selector_postal_conflict', $reason, 'postal conflict reason');

$addressConflict = $usable;
$addressConflict['address_reconstruction'] = 'conflict';
assert_hybrid_same(false, delivery_test_hybrid_result_is_usable($addressConflict, $vision, $reason), 'address conflict fallback');
assert_hybrid_same('selector_address_conflict', $reason, 'address conflict reason');

$noTextSummary = delivery_test_hybrid_vision_summary(['ok' => true, 'has_text' => false], 90);
assert_hybrid_same('no_text', $noTextSummary['state'], 'no-text summary');
assert_hybrid_same(false, $noTextSummary['ok'], 'no-text is not operationally usable');

echo "Delivery hybrid OCR support fixtures: PASS\n";
