<?php

// This helper is only loaded by the test OCR endpoint.
if (realpath((string)($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
  http_response_code(404);
  exit;
}

function delivery_test_gemini_response_schema() {
  $string = ['type' => 'STRING'];
  return [
    'type' => 'OBJECT',
    'properties' => [
      'address' => $string + ['description' => 'Recipient address through street number. Exclude building and room.'],
      'address_lines' => [
        'type' => 'ARRAY',
        'items' => $string,
        'maxItems' => 12,
        'description' => 'Recipient postal/address lines in logical reading order. Exclude building, room, name, and sender.'
      ],
      'postal_code' => $string + ['description' => 'Japanese postal code in XXX-XXXX form, or empty.'],
      'sender_address' => $string + ['description' => 'Sender address, or empty.'],
      'recipient' => $string + ['description' => 'Recipient name, or empty.'],
      'building' => $string + ['description' => 'Building name, or empty.'],
      'room' => $string + ['description' => 'Room number, or empty.'],
      'note' => $string + ['description' => 'Other delivery note such as floor, or empty.'],
      'confidence' => ['type' => 'STRING', 'enum' => ['high', 'medium', 'low']],
      'error' => $string + ['description' => 'Reason when no recipient address can be read, otherwise empty.'],
      'rotation_hint' => ['type' => 'INTEGER', 'description' => 'Clockwise rotation hint: 0, 90, 180, or 270.']
    ],
    'required' => [
      'address', 'address_lines', 'postal_code', 'sender_address', 'recipient', 'building',
      'room', 'note', 'confidence', 'error', 'rotation_hint'
    ]
  ];
}

function delivery_test_first_balanced_json_object($text) {
  $length = strlen($text);
  $start = -1;
  $depth = 0;
  $inString = false;
  $escaped = false;

  for ($i = 0; $i < $length; $i++) {
    $char = $text[$i];
    if ($inString) {
      if ($escaped) {
        $escaped = false;
      } elseif ($char === '\\') {
        $escaped = true;
      } elseif ($char === '"') {
        $inString = false;
      }
      continue;
    }
    if ($char === '"') {
      $inString = true;
      continue;
    }
    if ($char === '{') {
      if ($depth === 0) $start = $i;
      $depth++;
      continue;
    }
    if ($char === '}' && $depth > 0) {
      $depth--;
      if ($depth === 0 && $start >= 0) {
        return substr($text, $start, $i - $start + 1);
      }
    }
  }
  return '';
}

function delivery_test_decode_gemini_json($text, &$decodeError = '') {
  $decodeError = '';
  $text = preg_replace('/^\xEF\xBB\xBF/', '', trim((string)$text));
  $candidates = [$text];
  if (preg_match('/```(?:json)?\s*([\s\S]*?)\s*```/i', $text, $match)) {
    $candidates[] = trim($match[1]);
  }
  $balanced = delivery_test_first_balanced_json_object($text);
  if ($balanced !== '') $candidates[] = $balanced;

  foreach (array_values(array_unique(array_filter($candidates, 'strlen'))) as $candidate) {
    $decoded = json_decode($candidate, true);
    if (is_array($decoded)) return $decoded;
    $decodeError = json_last_error_msg();
  }
  if ($decodeError === '') $decodeError = 'JSON object was not found';
  return null;
}

function delivery_test_normalize_ocr_width($value) {
  $text = (string)$value;
  if (class_exists('Normalizer')) {
    $normalized = Normalizer::normalize($text, Normalizer::FORM_KC);
    if ($normalized !== false) $text = $normalized;
  } elseif (function_exists('mb_convert_kana')) {
    $text = mb_convert_kana($text, 'ans', 'UTF-8');
  }
  return str_replace(
    ["\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}", "\u{2015}", "\u{2212}", '－'],
    '-',
    $text
  );
}

function delivery_test_clean_recipient_address_line($value) {
  $line = delivery_test_normalize_ocr_width($value);
  $line = preg_replace('/[\t\r\n\x{3000} ]+/u', ' ', $line);
  $line = trim((string)$line);
  $line = preg_replace(
    '/^(?:お届け先(?:様)?|届け先(?:様)?|宛先|送付先|配送先|ご住所|住所|郵便番号)\s*[:：]?\s*/u',
    '',
    $line
  );
  return trim((string)$line);
}

function delivery_test_normalize_address_lines($value) {
  if (is_string($value)) {
    $value = preg_split('/\R/u', $value);
  }
  if (!is_array($value)) return [];
  $lines = [];
  foreach ($value as $line) {
    if (!is_scalar($line)) continue;
    $clean = delivery_test_clean_recipient_address_line($line);
    if ($clean === '') continue;
    if (function_exists('mb_substr')) {
      $clean = mb_substr($clean, 0, 120, 'UTF-8');
    } elseif (preg_match('/^.{0,120}/us', $clean, $shortened)) {
      $clean = $shortened[0];
    }
    $lines[] = $clean;
    if (count($lines) >= 12) break;
  }
  return $lines;
}

function delivery_test_prepare_address_candidate($value) {
  $text = delivery_test_normalize_ocr_width($value);
  $text = preg_replace(
    '/^(?:お届け先(?:様)?|届け先(?:様)?|宛先|送付先|配送先|ご住所|住所)\s*[:：]?\s*/u',
    '',
    trim((string)$text)
  );
  $text = preg_replace('/[\t\r\n\x{3000} ]+/u', '', (string)$text);
  $text = preg_replace('/(?<=\d)ー|ー(?=\d)/u', '-', (string)$text);
  $postalCode = '';
  if (preg_match('/〒?(\d{3})-?(\d{4})/u', $text, $match)) {
    $postalCode = $match[1] . '-' . $match[2];
    $text = preg_replace('/〒?\d{3}-?\d{4}/u', '', $text, 1);
  }
  $text = preg_replace('/(\d+)丁目/u', '$1-', (string)$text);
  $text = preg_replace('/(\d+)番地?/u', '$1-', (string)$text);
  $text = preg_replace('/(\d+)号(?!室)/u', '$1', (string)$text);
  $text = preg_replace('/(?<=\d)の(?=\d)/u', '-', (string)$text);
  $text = preg_replace('/-+/u', '-', (string)$text);
  $text = trim((string)$text, "- \t\r\n\0\x0B");
  if ($text === '') return $postalCode === '' ? '' : '〒' . $postalCode;
  return ($postalCode === '' ? '' : '〒' . $postalCode . ' ') . $text;
}

function delivery_test_compact_component($value) {
  $value = delivery_test_normalize_ocr_width($value);
  return preg_replace('/[\s\x{3000}]+/u', '', trim((string)$value));
}

function delivery_test_strip_compact_suffix($value, $suffix) {
  $value = (string)$value;
  $suffix = (string)$suffix;
  if ($value === '' || $suffix === '' || strlen($suffix) > strlen($value)) return $value;
  return substr($value, -strlen($suffix)) === $suffix
    ? substr($value, 0, strlen($value) - strlen($suffix))
    : $value;
}

function delivery_test_is_likely_room_number_text($value) {
  $digits = preg_replace('/\D/u', '', (string)$value);
  if (!preg_match('/^\d{3,4}$/', (string)$digits)) return false;
  $number = (int)$digits;
  $floor = intdiv($number, 100);
  $roomOnFloor = $number % 100;
  return $floor >= 1 && $floor <= 60 && $roomOnFloor >= 1 && $roomOnFloor <= 40;
}

function delivery_test_join_recipient_address_parts(array $parts) {
  $joined = '';
  foreach ($parts as $part) {
    $part = (string)$part;
    if ($part === '') continue;
    if ($joined === '') {
      $joined = $part;
      continue;
    }
    $digitBoundary = preg_match('/\d$/u', $joined) && preg_match('/^\d/u', $part);
    if ($digitBoundary) {
      $hasStreetChain = (bool)preg_match('/\d+(?:-\d+)+$/u', $joined);
      if ($hasStreetChain && preg_match('/^\d{3,4}$/', $part) &&
          delivery_test_is_likely_room_number_text($part)) {
        continue;
      }
      $joined .= '-' . $part;
      continue;
    }
    $joined .= $part;
  }
  return $joined;
}

function delivery_test_reconstruct_address_from_lines(array $lines, array $result) {
  if (!$lines) return '';
  $building = delivery_test_compact_component($result['building'] ?? '');
  $recipient = delivery_test_compact_component($result['recipient'] ?? '');
  $room = delivery_test_compact_component($result['room'] ?? ($result['room_number'] ?? ''));
  $room = preg_replace('/(?:号室|室)$/u', '', (string)$room);
  $parts = [];

  foreach ($lines as $line) {
    $part = delivery_test_compact_component(delivery_test_clean_recipient_address_line($line));
    if ($part === '') continue;
    if ($room !== '') {
      foreach ([$room . '号室', $room . '室'] as $roomSuffix) {
        $part = delivery_test_strip_compact_suffix($part, $roomSuffix);
      }
      if ($part === $room) $part = '';
    }
    $knownSuffixes = $recipient === ''
      ? [$building]
      : [$recipient . '様', $recipient . '御中', $recipient, $building];
    foreach ($knownSuffixes as $component) {
      if ($component === '') continue;
      $part = delivery_test_strip_compact_suffix($part, $component);
    }
    if ($part !== '') $parts[] = $part;
  }

  return delivery_test_prepare_address_candidate(delivery_test_join_recipient_address_parts($parts));
}

function delivery_test_address_postal_code($value) {
  $text = delivery_test_normalize_ocr_width($value);
  return preg_match('/〒?(\d{3})-?(\d{4})/u', $text, $match)
    ? $match[1] . '-' . $match[2]
    : '';
}

function delivery_test_address_body($value) {
  $prepared = delivery_test_prepare_address_candidate($value);
  return trim((string)preg_replace('/^〒\d{3}-\d{4}\s*/u', '', $prepared));
}

function delivery_test_address_key($value) {
  $body = delivery_test_address_body($value);
  $body = preg_replace('/[^\p{L}\p{N}]+/u', '', $body);
  return strtolower((string)$body);
}

function delivery_test_address_number_prefix($value) {
  $body = delivery_test_address_body($value);
  return preg_match('/^([^\d]+)\d/u', $body, $match) ? $match[1] : '';
}

function delivery_test_address_number_strength($value) {
  $body = delivery_test_address_body($value);
  if (preg_match('/\d+(?:-\d+){1,4}/u', $body, $match)) {
    return substr_count($match[0], '-') + 1;
  }
  return preg_match('/\d+/u', $body) ? 1 : 0;
}

function delivery_test_is_structured_street_address($value) {
  $body = delivery_test_address_body($value);
  return (bool)preg_match('/^[^\d]{3,}\d+(?:-\d+){0,4}$/u', $body);
}

function delivery_test_choose_reconstructed_address($modelAddress, $lineAddress, &$status = 'model') {
  $model = delivery_test_prepare_address_candidate($modelAddress);
  $lines = delivery_test_prepare_address_candidate($lineAddress);
  if ($lines === '') {
    $status = $model === '' ? 'empty' : 'model';
    return $model;
  }
  if ($model === '') {
    $status = 'used_lines';
    return $lines;
  }

  $modelPostal = delivery_test_address_postal_code($model);
  $linePostal = delivery_test_address_postal_code($lines);
  if ($modelPostal !== '' && $linePostal !== '' && $modelPostal !== $linePostal) {
    $status = 'conflict';
    return $model;
  }

  $modelKey = delivery_test_address_key($model);
  $lineKey = delivery_test_address_key($lines);
  if ($modelKey === $lineKey) {
    if (delivery_test_address_number_strength($lines) > delivery_test_address_number_strength($model)) {
      $status = 'used_lines';
      return $lines;
    }
    $status = 'matched';
    return $model;
  }

  $sameNumberPrefix = delivery_test_address_number_prefix($model) !== '' &&
    delivery_test_address_number_prefix($model) === delivery_test_address_number_prefix($lines);
  if ($sameNumberPrefix && delivery_test_is_structured_street_address($lines) &&
      (!delivery_test_is_structured_street_address($model) ||
       delivery_test_address_number_strength($lines) >= delivery_test_address_number_strength($model))) {
    $status = 'used_lines';
    return $lines;
  }
  if ($modelKey !== '' && strpos($lineKey, $modelKey) === 0 &&
      delivery_test_address_number_strength($lines) > delivery_test_address_number_strength($model)) {
    $status = 'used_lines';
    return $lines;
  }

  $status = 'conflict';
  return $model;
}

function delivery_test_normalize_ocr_result(array $result) {
  $stringFields = [
    'address', 'postal_code', 'sender_address', 'recipient',
    'building', 'room', 'note', 'error'
  ];
  $normalized = [];
  foreach ($stringFields as $field) {
    $value = $result[$field] ?? '';
    $normalized[$field] = is_scalar($value) ? trim((string)$value) : '';
  }
  $normalized['postal_code'] = delivery_test_address_postal_code($normalized['postal_code']);
  if ($normalized['postal_code'] !== '' &&
      delivery_test_address_postal_code($normalized['address']) === '' &&
      $normalized['address'] !== '') {
    $normalized['address'] = '〒' . $normalized['postal_code'] . ' ' . $normalized['address'];
  }
  $normalized['address_lines'] = delivery_test_normalize_address_lines($result['address_lines'] ?? []);
  $lineAddress = delivery_test_reconstruct_address_from_lines($normalized['address_lines'], $normalized);
  $reconstructionStatus = 'model';
  $normalized['address'] = delivery_test_choose_reconstructed_address(
    $normalized['address'],
    $lineAddress,
    $reconstructionStatus
  );
  $normalized['address_reconstruction'] = $reconstructionStatus;
  if ($normalized['postal_code'] === '') {
    $normalized['postal_code'] = delivery_test_address_postal_code($normalized['address']);
  }
  if ($normalized['postal_code'] !== '' &&
      delivery_test_address_postal_code($normalized['address']) === '' &&
      $normalized['address'] !== '') {
    $normalized['address'] = '〒' . $normalized['postal_code'] . ' ' . $normalized['address'];
  }
  $confidence = strtolower(trim((string)($result['confidence'] ?? 'low')));
  $normalized['confidence'] = in_array($confidence, ['high', 'medium', 'low'], true)
    ? $confidence
    : 'low';
  if ($reconstructionStatus === 'conflict' && $normalized['confidence'] === 'high') {
    $normalized['confidence'] = 'medium';
  }
  $rotationHint = (int)($result['rotation_hint'] ?? 0);
  $normalized['rotation_hint'] = in_array($rotationHint, [0, 90, 180, 270], true)
    ? $rotationHint
    : 0;
  if ($normalized['address'] !== '') {
    $normalized['error'] = '';
  } elseif ($normalized['error'] === '') {
    $normalized['error'] = '住所を読み取れませんでした';
  }
  return $normalized;
}
