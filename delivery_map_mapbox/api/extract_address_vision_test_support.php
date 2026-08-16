<?php

// Pure helpers for the test-only Cloud Vision comparison endpoint.

function delivery_test_vision_detected_mime_type($binary) {
  if (strncmp($binary, "\xFF\xD8\xFF", 3) === 0) return 'image/jpeg';
  if (strncmp($binary, "\x89PNG\r\n\x1A\n", 8) === 0) return 'image/png';
  if (strlen($binary) >= 12 && substr($binary, 0, 4) === 'RIFF' && substr($binary, 8, 4) === 'WEBP') return 'image/webp';
  return '';
}

function delivery_test_vision_normalize_width($value) {
  $text = (string)$value;
  if (function_exists('mb_convert_kana')) {
    $text = mb_convert_kana($text, 'asKV', 'UTF-8');
  } else {
    $from = ['０','１','２','３','４','５','６','７','８','９','Ａ','Ｂ','Ｃ','Ｄ','Ｅ','Ｆ','Ｇ','Ｈ','Ｉ','Ｊ','Ｋ','Ｌ','Ｍ','Ｎ','Ｏ','Ｐ','Ｑ','Ｒ','Ｓ','Ｔ','Ｕ','Ｖ','Ｗ','Ｘ','Ｙ','Ｚ'];
    $to =   ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
    $text = str_replace($from, $to, $text);
  }
  return str_replace(['－','ー','―','‐','−','–','—'], '-', $text);
}

function delivery_test_vision_clean_line($value) {
  $line = delivery_test_vision_normalize_width($value);
  $line = preg_replace('/[\t\x{3000} ]+/u', ' ', $line);
  $line = trim((string)$line);
  $line = preg_replace('/^(?:お届け先(?:様)?|届け先(?:様)?|宛先|送付先|配送先|ご住所|住所|郵便番号)\s*[:：]?\s*/u', '', $line);
  return trim((string)$line);
}

function delivery_test_vision_unique_values(array $values, $limit = 12) {
  $result = [];
  $seen = [];
  foreach ($values as $value) {
    $clean = delivery_test_vision_clean_line($value);
    if ($clean === '') continue;
    $key = preg_replace('/[\s\-〒]/u', '', $clean);
    if ($key === '' || isset($seen[$key])) continue;
    $seen[$key] = true;
    $result[] = $clean;
    if (count($result) >= $limit) break;
  }
  return $result;
}

function delivery_test_vision_extract_postal_codes($text) {
  $normalized = delivery_test_vision_normalize_width($text);
  preg_match_all('/(?:〒\s*)?(\d{3})\s*-?\s*(\d{4})/u', $normalized, $matches, PREG_SET_ORDER);
  $values = [];
  foreach ($matches as $match) {
    $values[] = $match[1] . '-' . $match[2];
  }
  return delivery_test_vision_unique_values($values, 8);
}

function delivery_test_vision_normalize_address_candidate($value) {
  $candidate = delivery_test_vision_clean_line($value);
  $candidate = preg_replace('/(?:〒\s*)?\d{3}\s*-?\s*\d{4}/u', '', $candidate);
  $candidate = preg_replace('/\s*(\d+)\s*丁目\s*/u', '$1-', $candidate);
  $candidate = preg_replace('/\s*(\d+)\s*番地?\s*/u', '$1-', $candidate);
  $candidate = preg_replace('/\s*(\d+)\s*号\s*/u', '$1', $candidate);
  $candidate = preg_replace('/\s*-\s*/u', '-', $candidate);
  $candidate = preg_replace('/-+/u', '-', $candidate);
  return trim((string)$candidate, " \t\n\r\0\x0B-");
}

function delivery_test_vision_extract_address_candidates($text) {
  $normalized = delivery_test_vision_normalize_width($text);
  $rawLines = preg_split('/\R/u', $normalized);
  $lines = [];
  foreach ($rawLines as $line) {
    $clean = delivery_test_vision_clean_line($line);
    if ($clean !== '') $lines[] = $clean;
  }

  $prefecture = '(?:東京都|北海道|(?:京都|大阪)府|[一-龯々]{2,3}県)';
  $numberTail = '\d+(?:(?:\s*-\s*|\s*(?:丁目|番地?|号|の)\s*)\d+){0,4}(?:\s*号)?';
  $patterns = [
    '/' . $prefecture . '.{2,100}?' . $numberTail . '/u',
    '/[一-龯々ぁ-んァ-ヶー]{1,30}(?:市|区|郡|町|村).{1,80}?' . $numberTail . '/u'
  ];
  $candidates = [];

  $lineCount = count($lines);
  for ($start = 0; $start < $lineCount; $start++) {
    $combined = '';
    for ($span = 0; $span < 4 && ($start + $span) < $lineCount; $span++) {
      $combined .= ($combined === '' ? '' : ' ') . $lines[$start + $span];
      foreach ($patterns as $pattern) {
        if (preg_match_all($pattern, $combined, $matches)) {
          foreach ($matches[0] as $match) {
            $candidate = delivery_test_vision_normalize_address_candidate($match);
            if ($candidate !== '') $candidates[] = $candidate;
          }
        }
      }
    }
  }
  return delivery_test_vision_unique_values($candidates, 10);
}

function delivery_test_vision_extract_room_candidates($text) {
  $normalized = delivery_test_vision_normalize_width($text);
  $values = [];
  $patterns = [
    '/(?:部屋番号|ROOM|Room|room)\s*[:：]?\s*([A-Z]?\s*-?\s*\d{2,4})/u',
    '/([A-Z]\s*-\s*\d{2,4}|\d{2,4})\s*(?:号室|室)/u'
  ];
  foreach ($patterns as $pattern) {
    if (!preg_match_all($pattern, $normalized, $matches)) continue;
    foreach ($matches[1] as $match) {
      $values[] = preg_replace('/\s+/u', '', $match);
    }
  }
  $postalParts = [];
  foreach (delivery_test_vision_extract_postal_codes($normalized) as $postalCode) {
    foreach (explode('-', $postalCode) as $part) $postalParts[$part] = true;
  }
  foreach (preg_split('/\R/u', $normalized) as $line) {
    $line = preg_replace('/\s+/u', '', delivery_test_vision_clean_line($line));
    if (!preg_match('/^(?:[A-Z]-?)?\d{2,4}$/u', $line)) continue;
    if (isset($postalParts[$line])) continue;
    $values[] = $line;
  }
  return delivery_test_vision_unique_values($values, 12);
}

function delivery_test_vision_average_confidence(array $response) {
  $weightedTotal = 0.0;
  $weight = 0;
  $pages = $response['fullTextAnnotation']['pages'] ?? [];
  foreach ($pages as $page) {
    foreach (($page['blocks'] ?? []) as $block) {
      foreach (($block['paragraphs'] ?? []) as $paragraph) {
        foreach (($paragraph['words'] ?? []) as $word) {
          if (!isset($word['confidence']) || !is_numeric($word['confidence'])) continue;
          $wordWeight = max(1, count($word['symbols'] ?? []));
          $weightedTotal += (float)$word['confidence'] * $wordWeight;
          $weight += $wordWeight;
        }
      }
    }
  }
  return $weight > 0 ? round($weightedTotal / $weight, 3) : null;
}

function delivery_test_vision_parse_response(array $payload) {
  $response = $payload['responses'][0] ?? null;
  if (!is_array($response)) {
    return ['ok' => false, 'error_code' => 'empty_response', 'error' => 'Cloud Visionの応答が空です'];
  }
  if (!empty($response['error'])) {
    return [
      'ok' => false,
      'error_code' => 'vision_response_error',
      'error' => (string)($response['error']['message'] ?? 'Cloud Visionがエラーを返しました')
    ];
  }

  $text = (string)($response['fullTextAnnotation']['text'] ?? ($response['textAnnotations'][0]['description'] ?? ''));
  $text = trim($text);
  if ($text === '') {
    return [
      'ok' => true,
      'provider' => 'google-cloud-vision',
      'text' => '',
      'postal_codes' => [],
      'address_candidates' => [],
      'room_candidates' => [],
      'confidence' => delivery_test_vision_average_confidence($response),
      'has_text' => false
    ];
  }
  if (function_exists('mb_substr')) $text = mb_substr($text, 0, 20000, 'UTF-8');
  else $text = substr($text, 0, 40000);

  return [
    'ok' => true,
    'provider' => 'google-cloud-vision',
    'text' => $text,
    'postal_codes' => delivery_test_vision_extract_postal_codes($text),
    'address_candidates' => delivery_test_vision_extract_address_candidates($text),
    'room_candidates' => delivery_test_vision_extract_room_candidates($text),
    'confidence' => delivery_test_vision_average_confidence($response),
    'has_text' => true
  ];
}
