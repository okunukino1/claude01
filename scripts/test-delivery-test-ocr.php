<?php

require_once __DIR__ . '/../delivery_map_mapbox/api/extract_address_test_support.php';

function assert_same($expected, $actual, $label) {
  if ($expected === $actual) return;
  fwrite(
    STDERR,
    $label . "\nexpected: " . json_encode($expected, JSON_UNESCAPED_UNICODE) .
    "\nactual:   " . json_encode($actual, JSON_UNESCAPED_UNICODE) . "\n"
  );
  exit(1);
}

$schema = delivery_test_gemini_response_schema();
assert_same('ARRAY', $schema['properties']['address_lines']['type'], 'address_lines schema type');
assert_same(true, in_array('address_lines', $schema['required'], true), 'address_lines is required');

$splitNumber = delivery_test_normalize_ocr_result([
  'address' => '〒103-0015 東京都中央区日本橋箱崎町43',
  'address_lines' => ['〒103-0015', '東京都中央区日本橋箱崎町', '43-', '5'],
  'postal_code' => '103-0015',
  'sender_address' => '',
  'recipient' => '',
  'building' => '',
  'room' => '',
  'note' => '',
  'confidence' => 'high',
  'error' => '',
  'rotation_hint' => 0
]);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $splitNumber['address'],
  'street number split after dash'
);
assert_same('used_lines', $splitNumber['address_reconstruction'], 'line reconstruction used');

$leadingDash = delivery_test_reconstruct_address_from_lines(
  ['〒103-0015', '東京都中央区日本橋箱崎町43', '-5'],
  []
);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $leadingDash,
  'street number split before dash'
);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  delivery_test_reconstruct_address_from_lines(
    ['〒103-0015', '東京都中央区日本橋箱崎町43', '5'],
    []
  ),
  'street number split without printed dash'
);

$buildingAndRoom = delivery_test_normalize_ocr_result([
  'address' => '東京都中央区日本橋箱崎町43-5',
  'address_lines' => [
    '〒103-0015',
    '東京都中央区日本橋箱崎町',
    '43-',
    '5',
    'スクエア日本橋',
    '102号室'
  ],
  'postal_code' => '103-0015',
  'sender_address' => '',
  'recipient' => '',
  'building' => 'スクエア日本橋',
  'room' => '102',
  'note' => '',
  'confidence' => 'high',
  'error' => '',
  'rotation_hint' => 0
]);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $buildingAndRoom['address'],
  'known building and room excluded from reconstructed address'
);
assert_same('matched', $buildingAndRoom['address_reconstruction'], 'matching reconstruction retained');

$combinedBuildingAndRoom = delivery_test_reconstruct_address_from_lines(
  ['〒103-0015', '東京都中央区日本橋箱崎町43-5 スクエア日本橋 102号室'],
  ['building' => 'スクエア日本橋', 'room' => '102']
);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $combinedBuildingAndRoom,
  'building and room on same line are excluded'
);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  delivery_test_reconstruct_address_from_lines(
    ['〒103-0015', '東京都中央区日本橋箱崎町43-5', '102'],
    []
  ),
  'standalone likely room is not appended to a complete street number'
);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  delivery_test_reconstruct_address_from_lines(
    ['〒103-0015', '東京都中央区日本橋箱崎町43-5 山田太郎様'],
    ['recipient' => '山田太郎']
  ),
  'recipient suffix is excluded'
);

$japaneseNumbering = delivery_test_reconstruct_address_from_lines(
  ['〒212-0002', '神奈川県川崎市幸区塚越', '3丁目', '484番', '1号'],
  []
);
assert_same(
  '〒212-0002 神奈川県川崎市幸区塚越3-484-1',
  $japaneseNumbering,
  'chome ban go normalization'
);
assert_same(
  '東京都大田区ニュータウン1-2',
  delivery_test_prepare_address_candidate('東京都大田区ニュータウン1ー2'),
  'katakana long vowel is preserved outside number boundary'
);

$conflict = delivery_test_normalize_ocr_result([
  'address' => '〒103-0015 東京都中央区日本橋箱崎町43-5',
  'address_lines' => ['〒103-0014', '東京都中央区日本橋蛎殻町1-2-3'],
  'postal_code' => '103-0015',
  'sender_address' => '',
  'recipient' => '',
  'building' => '',
  'room' => '',
  'note' => '',
  'confidence' => 'high',
  'error' => '',
  'rotation_hint' => 0
]);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $conflict['address'],
  'postal conflict keeps model address'
);
assert_same('conflict', $conflict['address_reconstruction'], 'conflict is recorded');
assert_same('medium', $conflict['confidence'], 'conflict lowers high confidence');

$declaredPostalConflict = delivery_test_normalize_ocr_result([
  'address' => '東京都中央区日本橋箱崎町43-5',
  'address_lines' => ['〒103-0014', '東京都中央区日本橋蛎殻町1-2-3'],
  'postal_code' => '103-0015',
  'confidence' => 'high',
  'rotation_hint' => 0
]);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $declaredPostalConflict['address'],
  'declared postal code participates in line conflict check'
);
assert_same('conflict', $declaredPostalConflict['address_reconstruction'], 'declared postal conflict recorded');

$legacy = delivery_test_normalize_ocr_result([
  'address' => "〒103-0015\n東京都中央区日本橋箱崎町43-5",
  'postal_code' => '',
  'confidence' => 'high',
  'rotation_hint' => 0
]);
assert_same(
  '〒103-0015 東京都中央区日本橋箱崎町43-5',
  $legacy['address'],
  'legacy address without address_lines remains compatible'
);
assert_same([], $legacy['address_lines'], 'legacy address_lines defaults empty');

echo "Test delivery OCR reconstruction fixtures: PASS\n";
