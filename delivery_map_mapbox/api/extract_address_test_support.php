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
      'postal_code' => $string + ['description' => 'Japanese postal code in XXX-XXXX form, or empty.'],
      'sender_address' => $string + ['description' => 'Sender address, or empty.'],
      'recipient' => $string + ['description' => 'Recipient name, or empty.'],
      'building' => $string + ['description' => 'Building name, or empty.'],
      'room' => $string + ['description' => 'Room number, or empty.'],
      'note' => $string + ['description' => 'Other delivery note such as floor, or empty.'],
      'confidence' => ['type' => 'STRING', 'enum' => ['high', 'medium', 'low']],
      'error' => $string + ['description' => 'Reason when no recipient address can be read, otherwise empty.'],
      'rotation_hint' => ['type' => 'INTEGER', 'enum' => [0, 90, 180, 270]]
    ],
    'required' => [
      'address', 'postal_code', 'sender_address', 'recipient', 'building',
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
  $confidence = strtolower(trim((string)($result['confidence'] ?? 'low')));
  $normalized['confidence'] = in_array($confidence, ['high', 'medium', 'low'], true)
    ? $confidence
    : 'low';
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
