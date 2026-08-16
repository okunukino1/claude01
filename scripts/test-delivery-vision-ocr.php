<?php

require_once __DIR__ . '/../delivery_map_mapbox/api/extract_address_vision_test_support.php';

function assert_same($expected, $actual, $label) {
  if ($expected === $actual) return;
  fwrite(STDERR, $label . "\nexpected: " . json_encode($expected, JSON_UNESCAPED_UNICODE) . "\nactual:   " . json_encode($actual, JSON_UNESCAPED_UNICODE) . "\n");
  exit(1);
}

assert_same('image/jpeg', delivery_test_vision_detected_mime_type("\xFF\xD8\xFFsample"), 'jpeg signature');
assert_same('image/png', delivery_test_vision_detected_mime_type("\x89PNG\r\n\x1A\nsample"), 'png signature');
assert_same('', delivery_test_vision_detected_mime_type('not-an-image'), 'invalid signature');

$label = <<<TXT
お届け先
〒103-0015
東京都中央区日本橋箱崎町43-5
スクエア日本橋
102
ご依頼主
〒103-0014 東京都中央区日本橋蛎殻町1-2-3
TXT;

assert_same(
  ['103-0015', '103-0014'],
  delivery_test_vision_extract_postal_codes($label),
  'postal codes'
);
assert_same(
  ['東京都中央区日本橋箱崎町43-5', '東京都中央区日本橋蛎殻町1-2-3'],
  delivery_test_vision_extract_address_candidates($label),
  'address candidates'
);
assert_same(['102'], delivery_test_vision_extract_room_candidates($label), 'standalone room');

$explicitRoom = "〒212-0002\n神奈川県川崎市幸区塚越3-484-1\nラグゼコート C-413号室";
assert_same(['C-413'], delivery_test_vision_extract_room_candidates($explicitRoom), 'explicit room');

$parsed = delivery_test_vision_parse_response([
  'responses' => [[
    'fullTextAnnotation' => [
      'text' => $label,
      'pages' => [[
        'blocks' => [[
          'paragraphs' => [[
            'words' => [
              ['confidence' => 0.9, 'symbols' => [[], []]],
              ['confidence' => 0.7, 'symbols' => [[]]]
            ]
          ]]
        ]]
      ]]
    ]
  ]]
]);

assert_same(true, $parsed['ok'], 'parsed ok');
assert_same(true, $parsed['has_text'], 'parsed has text');
assert_same(0.833, $parsed['confidence'], 'weighted confidence');
assert_same(['102'], $parsed['room_candidates'], 'parsed room candidates');

echo "Cloud Vision OCR support fixtures: PASS\n";
