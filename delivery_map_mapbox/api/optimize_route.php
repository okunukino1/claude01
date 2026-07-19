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
  echo json_encode(['error' => 'サーバー設定ファイルがありません', 'hint' => 'api/config.php を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}
require_once $configFile;

$token = '';
if (defined('MAPBOX_OPTIMIZATION_TOKEN') && MAPBOX_OPTIMIZATION_TOKEN) {
  $token = MAPBOX_OPTIMIZATION_TOKEN;
} elseif (defined('MAPBOX_ACCESS_TOKEN') && MAPBOX_ACCESS_TOKEN) {
  $token = MAPBOX_ACCESS_TOKEN;
}

if (!$token || $token === 'pk.eyJ...Mapbox公開トークン...') {
  http_response_code(500);
  echo json_encode(['error' => 'Mapboxルート最適化トークンが未設定です', 'hint' => 'api/config.php の MAPBOX_ACCESS_TOKEN または MAPBOX_OPTIMIZATION_TOKEN を確認してください。'], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}
$preserveAllPoints = !empty($input['preserve_all_points']);

function valid_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function distance_meters($a, $b) {
  $lat1 = deg2rad((float)$a['lat']);
  $lat2 = deg2rad((float)$b['lat']);
  $dLat = $lat2 - $lat1;
  $dLng = deg2rad((float)$b['lng'] - (float)$a['lng']);
  $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
  return 6371000 * 2 * atan2(sqrt($h), sqrt(max(0, 1 - $h)));
}

$start = $input['start'] ?? null;
if (!is_array($start) || !valid_coord($start['lat'] ?? null) || !valid_coord($start['lng'] ?? null)) {
  http_response_code(400);
  echo json_encode(['error' => '始点の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}
$start = ['id' => '__start__', 'lat' => (float)$start['lat'], 'lng' => (float)$start['lng']];

$points = $input['points'] ?? [];
if (!is_array($points)) $points = [];

$cleanPoints = [];
foreach ($points as $p) {
  if (!is_array($p)) continue;
  $id = trim((string)($p['id'] ?? ''));
  if ($id === '' || !valid_coord($p['lat'] ?? null) || !valid_coord($p['lng'] ?? null)) continue;
  $cleanPoints[] = ['id' => $id, 'lat' => (float)$p['lat'], 'lng' => (float)$p['lng']];
}

if (count($cleanPoints) < 2) {
  http_response_code(400);
  echo json_encode(['error' => '車用ルート最適化には配送先が2件以上必要です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$allCleanPoints = $cleanPoints;
$endHint = null;
if ($preserveAllPoints && array_key_exists('end_hint', $input)) {
  $hint = $input['end_hint'];
  if (!is_array($hint) || !valid_coord($hint['lat'] ?? null) || !valid_coord($hint['lng'] ?? null)) {
    http_response_code(400);
    echo json_encode(['error' => '次エリア目標の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $hintLat = (float)$hint['lat'];
  $hintLng = (float)$hint['lng'];
  if ($hintLat < -90 || $hintLat > 90 || $hintLng < -180 || $hintLng > 180) {
    http_response_code(400);
    echo json_encode(['error' => '次エリア目標の緯度経度が範囲外です'], JSON_UNESCAPED_UNICODE);
    exit;
  }
  $endHint = ['id' => '__end_hint__', 'lat' => $hintLat, 'lng' => $hintLng];
}

// Optimization API v1 は始点込み12座標まで。12件以上は Matrix + Directions で補助最適化する。
if (count($cleanPoints) > 24) {
  http_response_code(400);
  echo json_encode([
    'error' => '車用ルート最適化は一度に24件まで対応しています',
    'detail' => 'Mapbox Matrix/Directions API の最大25座標制限に合わせています。'
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$endIndex = 0;
$endDistance = -1;
foreach ($cleanPoints as $idx => $p) {
  $dist = distance_meters($start, $p);
  if ($dist > $endDistance) {
    $endDistance = $dist;
    $endIndex = $idx;
  }
}

$endPoint = $cleanPoints[$endIndex];
array_splice($cleanPoints, $endIndex, 1);
$orderedInput = array_merge([$start], $cleanPoints, [$endPoint]);

$coordText = implode(';', array_map(function($p) {
  return rawurlencode((string)$p['lng']) . ',' . rawurlencode((string)$p['lat']);
}, $orderedInput));

function request_origin_for_mapbox() {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '' && preg_match('/^https?:\/\//i', $origin)) return $origin . '/';

  $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($referer !== '' && preg_match('/^https?:\/\//i', $referer)) return $referer;

  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  if ($host !== '') {
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
      || (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    return ($https ? 'https://' : 'http://') . $host . '/';
  }

  return '';
}

function call_mapbox_optimization($profile, $coordText, $token, $useCurb, $count) {
  $params = [
    'access_token' => $token,
    'source' => 'first',
    'destination' => 'last',
    'roundtrip' => 'false',
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'true',
    'language' => 'ja',
    'annotations' => 'duration,distance'
  ];
  if ($useCurb) {
    $params['approaches'] = implode(';', array_merge(['unrestricted'], array_fill(0, $count - 1, 'curb')));
  }

  $url = 'https://api.mapbox.com/optimized-trips/v1/' . $profile . '/' . $coordText . '?' . http_build_query($params);
  $ch = curl_init($url);
  $headers = ['Accept: application/json'];
  $referer = request_origin_for_mapbox();
  if ($referer !== '') {
    $headers[] = 'Referer: ' . $referer;
    $parts = parse_url($referer);
    if (is_array($parts) && isset($parts['scheme'], $parts['host'])) {
      $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
      $headers[] = 'Origin: ' . $origin;
    }
  }

  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => $headers,
  ]);
  $body = curl_exec($ch);
  $curlErr = curl_error($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  return [
    'body' => $body,
    'curlErr' => $curlErr,
    'httpCode' => (int)$httpCode,
  ];
}

$profile = (string)($input['profile'] ?? 'mapbox/driving');
if (!in_array($profile, ['mapbox/driving', 'mapbox/driving-traffic'], true)) {
  $profile = 'mapbox/driving';
}

if (count($cleanPoints) > 11 && $profile === 'mapbox/driving-traffic') {
  $profile = 'mapbox/driving';
}

function response_error_from_mapbox($attempt) {
  $detail = substr((string)$attempt['body'], 0, 500);
  if ($attempt['body'] === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Mapbox APIへの接続に失敗しました', 'detail' => $attempt['curlErr']], JSON_UNESCAPED_UNICODE);
    exit;
  }
  if ($attempt['httpCode'] === 401 || $attempt['httpCode'] === 403) {
    http_response_code(502);
    echo json_encode([
      'error' => 'Mapboxトークンがルート検索APIで拒否されました',
      'detail' => 'MapboxのURL制限または権限設定が原因の可能性があります。api/config.php にサーバー用の MAPBOX_OPTIMIZATION_TOKEN を追加するか、Mapboxトークン設定を確認してください。応答: ' . $detail
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }
  http_response_code(502);
  echo json_encode(['error' => 'Mapbox API応答エラー', 'detail' => $detail], JSON_UNESCAPED_UNICODE);
  exit;
}

function matrix_cost($matrix, $from, $to, $fallbackPoints) {
  if (isset($matrix[$from][$to]) && is_numeric($matrix[$from][$to])) {
    return (float)$matrix[$from][$to];
  }
  return distance_meters($fallbackPoints[$from], $fallbackPoints[$to]) / 8.0;
}

function route_matrix_cost($route, $matrix, $points) {
  if (count($route) === 0) return 0;
  $total = matrix_cost($matrix, 0, $route[0], $points);
  for ($i = 1; $i < count($route); $i++) {
    $total += matrix_cost($matrix, $route[$i - 1], $route[$i], $points);
  }
  return $total;
}

function nearest_neighbor_matrix_route($matrix, $points) {
  $remaining = range(1, count($points) - 1);
  $route = [];
  $current = 0;
  while (count($remaining) > 0) {
    $bestPos = 0;
    $bestCost = INF;
    foreach ($remaining as $pos => $idx) {
      $cost = matrix_cost($matrix, $current, $idx, $points);
      if ($cost < $bestCost) {
        $bestCost = $cost;
        $bestPos = $pos;
      }
    }
    $next = $remaining[$bestPos];
    array_splice($remaining, $bestPos, 1);
    $route[] = $next;
    $current = $next;
  }
  return $route;
}

function improve_matrix_route($route, $matrix, $points) {
  if (count($route) < 4) return $route;
  $deadline = microtime(true) + 1.5;
  $routeCount = count($route);
  $maxPasses = min(80, max(12, $routeCount * 3));
  $changed = true;
  $guard = 0;
  while ($changed && $guard < $maxPasses && microtime(true) < $deadline) {
    $changed = false;
    $guard++;
    for ($i = 0; $i < count($route) - 1; $i++) {
      if (microtime(true) >= $deadline) break 2;
      for ($k = $i + 1; $k < count($route); $k++) {
        $a = $i === 0 ? 0 : $route[$i - 1];
        $b = $route[$i];
        $c = $route[$k];
        $d = ($k + 1 < count($route)) ? $route[$k + 1] : null;
        $before = matrix_cost($matrix, $a, $b, $points) + ($d === null ? 0 : matrix_cost($matrix, $c, $d, $points));
        $after = matrix_cost($matrix, $a, $c, $points) + ($d === null ? 0 : matrix_cost($matrix, $b, $d, $points));
        if ($after + 1 < $before) {
          $slice = array_reverse(array_slice($route, $i, $k - $i + 1));
          array_splice($route, $i, count($slice), $slice);
          $changed = true;
        }
      }
    }
  }
  return $route;
}

function matrix_route_cost_to_end($route, $matrix, $points, $endIndex) {
  if (count($route) === 0) return matrix_cost($matrix, 0, $endIndex, $points);
  $total = matrix_cost($matrix, 0, $route[0], $points);
  for ($i = 1; $i < count($route); $i++) {
    $total += matrix_cost($matrix, $route[$i - 1], $route[$i], $points);
  }
  return $total + matrix_cost($matrix, $route[count($route) - 1], $endIndex, $points);
}

function nearest_neighbor_matrix_route_to_end($matrix, $points, $endIndex) {
  $remaining = $endIndex > 1 ? range(1, $endIndex - 1) : [];
  $route = [];
  $current = 0;
  while (count($remaining) > 0) {
    $bestPos = 0;
    $bestCost = INF;
    foreach ($remaining as $pos => $idx) {
      $cost = matrix_cost($matrix, $current, $idx, $points);
      if ($cost < $bestCost) {
        $bestCost = $cost;
        $bestPos = $pos;
      }
    }
    $next = $remaining[$bestPos];
    array_splice($remaining, $bestPos, 1);
    $route[] = $next;
    $current = $next;
  }
  return $route;
}

function cheapest_insertion_matrix_route_to_end($matrix, $points, $endIndex) {
  $remaining = $endIndex > 1 ? range(1, $endIndex - 1) : [];
  $route = [];
  while (count($remaining) > 0) {
    $bestRemainingPos = 0;
    $bestInsertPos = 0;
    $bestDelta = INF;
    foreach ($remaining as $remainingPos => $idx) {
      for ($insertPos = 0; $insertPos <= count($route); $insertPos++) {
        $from = $insertPos === 0 ? 0 : $route[$insertPos - 1];
        $to = $insertPos === count($route) ? $endIndex : $route[$insertPos];
        $delta = matrix_cost($matrix, $from, $idx, $points)
          + matrix_cost($matrix, $idx, $to, $points)
          - matrix_cost($matrix, $from, $to, $points);
        if ($delta < $bestDelta) {
          $bestDelta = $delta;
          $bestRemainingPos = $remainingPos;
          $bestInsertPos = $insertPos;
        }
      }
    }
    $next = $remaining[$bestRemainingPos];
    array_splice($remaining, $bestRemainingPos, 1);
    array_splice($route, $bestInsertPos, 0, [$next]);
  }
  return $route;
}

function improve_asymmetric_matrix_route_to_end($route, $matrix, $points, $endIndex) {
  if (count($route) < 2) return $route;
  $deadline = microtime(true) + 1.5;
  $bestCost = matrix_route_cost_to_end($route, $matrix, $points, $endIndex);
  $maxPasses = min(80, max(12, count($route) * 3));

  for ($pass = 0; $pass < $maxPasses && microtime(true) < $deadline; $pass++) {
    $changed = false;
    for ($i = 0; $i < count($route) - 1; $i++) {
      for ($k = $i + 1; $k < count($route); $k++) {
        if (microtime(true) >= $deadline) break 2;
        $candidate = $route;
        $slice = array_reverse(array_slice($candidate, $i, $k - $i + 1));
        array_splice($candidate, $i, count($slice), $slice);
        $candidateCost = matrix_route_cost_to_end($candidate, $matrix, $points, $endIndex);
        if ($candidateCost + 1 < $bestCost) {
          $route = $candidate;
          $bestCost = $candidateCost;
          $changed = true;
          break 2;
        }
      }
    }
    if (!$changed) break;
  }
  return $route;
}

function call_mapbox_matrix($profile, $points, $token) {
  $coordText = implode(';', array_map(function($p) {
    return rawurlencode((string)$p['lng']) . ',' . rawurlencode((string)$p['lat']);
  }, $points));
  $params = [
    'access_token' => $token,
    'annotations' => 'duration,distance'
  ];
  $url = 'https://api.mapbox.com/directions-matrix/v1/' . $profile . '/' . $coordText . '?' . http_build_query($params);
  $ch = curl_init($url);
  $headers = ['Accept: application/json'];
  $referer = request_origin_for_mapbox();
  if ($referer !== '') {
    $headers[] = 'Referer: ' . $referer;
    $parts = parse_url($referer);
    if (is_array($parts) && isset($parts['scheme'], $parts['host'])) {
      $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
      $headers[] = 'Origin: ' . $origin;
    }
  }
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => $headers,
  ]);
  $body = curl_exec($ch);
  $curlErr = curl_error($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ['body' => $body, 'curlErr' => $curlErr, 'httpCode' => (int)$httpCode];
}

function call_mapbox_directions($profile, $points, $token) {
  $coordText = implode(';', array_map(function($p) {
    return rawurlencode((string)$p['lng']) . ',' . rawurlencode((string)$p['lat']);
  }, $points));
  $params = [
    'access_token' => $token,
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'true',
    'language' => 'ja'
  ];
  $url = 'https://api.mapbox.com/directions/v5/' . $profile . '/' . $coordText . '?' . http_build_query($params);
  $ch = curl_init($url);
  $headers = ['Accept: application/json'];
  $referer = request_origin_for_mapbox();
  if ($referer !== '') {
    $headers[] = 'Referer: ' . $referer;
    $parts = parse_url($referer);
    if (is_array($parts) && isset($parts['scheme'], $parts['host'])) {
      $origin = $parts['scheme'] . '://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
      $headers[] = 'Origin: ' . $origin;
    }
  }
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_HTTPHEADER => $headers,
  ]);
  $body = curl_exec($ch);
  $curlErr = curl_error($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  return ['body' => $body, 'curlErr' => $curlErr, 'httpCode' => (int)$httpCode];
}

// テスト版のエリア道路順だけが end_hint を送る。次エリアまでの道路時間を
// 終端コストへ加え、川・線路・一方通行を考慮した場所で現在エリアを終える。
if ($endHint !== null) {
  if (count($allCleanPoints) > 23) {
    http_response_code(400);
    echo json_encode([
      'error' => '次エリアを考慮する道路順は一度に23件まで対応しています',
      'detail' => 'Mapbox Matrix API の最大25座標（始点・次エリア目標を含む）に合わせています。'
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $matrixProfile = $profile;
  $matrixPoints = array_merge([$start], $allCleanPoints, [$endHint]);
  if ($matrixProfile === 'mapbox/driving-traffic' && count($matrixPoints) > 10) {
    $matrixProfile = 'mapbox/driving';
  }

  $matrixAttempt = call_mapbox_matrix($matrixProfile, $matrixPoints, $token);
  $matrixData = is_string($matrixAttempt['body']) ? json_decode($matrixAttempt['body'], true) : null;
  if ($matrixAttempt['body'] === false || $matrixAttempt['httpCode'] < 200 || $matrixAttempt['httpCode'] >= 300 || !is_array($matrixData) || (($matrixData['code'] ?? '') !== 'Ok')) {
    response_error_from_mapbox($matrixAttempt);
  }

  $durations = $matrixData['durations'] ?? [];
  if (!is_array($durations) || count($durations) !== count($matrixPoints)) {
    http_response_code(502);
    echo json_encode(['error' => 'Mapbox Matrix APIの応答形式が不正です'], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $endHintIndex = count($matrixPoints) - 1;
  $nearestRoute = nearest_neighbor_matrix_route_to_end($durations, $matrixPoints, $endHintIndex);
  $insertionRoute = cheapest_insertion_matrix_route_to_end($durations, $matrixPoints, $endHintIndex);
  $routeIndexes = matrix_route_cost_to_end($insertionRoute, $durations, $matrixPoints, $endHintIndex)
      < matrix_route_cost_to_end($nearestRoute, $durations, $matrixPoints, $endHintIndex)
    ? $insertionRoute
    : $nearestRoute;
  $routeIndexes = improve_asymmetric_matrix_route_to_end($routeIndexes, $durations, $matrixPoints, $endHintIndex);
  $orderedPoints = array_map(function($idx) use ($matrixPoints) { return $matrixPoints[$idx]; }, $routeIndexes);

  $directionsPoints = array_merge([$start], $orderedPoints);
  $directionsAttempt = call_mapbox_directions($matrixProfile, $directionsPoints, $token);
  $directionsData = is_string($directionsAttempt['body']) ? json_decode($directionsAttempt['body'], true) : null;
  if ($directionsAttempt['body'] === false || $directionsAttempt['httpCode'] < 200 || $directionsAttempt['httpCode'] >= 300 || !is_array($directionsData) || (($directionsData['code'] ?? '') !== 'Ok')) {
    response_error_from_mapbox($directionsAttempt);
  }

  $route = $directionsData['routes'][0] ?? [];
  $lastRouteIndex = count($routeIndexes) ? $routeIndexes[count($routeIndexes) - 1] : 0;
  $distances = $matrixData['distances'] ?? [];
  $exitDistance = isset($distances[$lastRouteIndex][$endHintIndex]) && is_numeric($distances[$lastRouteIndex][$endHintIndex])
    ? (float)$distances[$lastRouteIndex][$endHintIndex]
    : null;
  $exitDuration = isset($durations[$lastRouteIndex][$endHintIndex]) && is_numeric($durations[$lastRouteIndex][$endHintIndex])
    ? (float)$durations[$lastRouteIndex][$endHintIndex]
    : null;

  echo json_encode([
    'ok' => true,
    'profile' => $matrixProfile,
    'method' => 'matrix-directions-road-end',
    'allPointsPreserved' => true,
    'roadAwareEnd' => true,
    'orderedIds' => array_values(array_map(function($p) { return $p['id']; }, $orderedPoints)),
    'waypoints' => array_values(array_map(function($p, $idx) {
      return ['id' => $p['id'], 'waypoint_index' => $idx + 1, 'name' => '', 'location' => [$p['lng'], $p['lat']]];
    }, $orderedPoints, array_keys($orderedPoints))),
    'distance' => isset($route['distance']) ? (float)$route['distance'] : null,
    'duration' => isset($route['duration']) ? (float)$route['duration'] : route_matrix_cost($routeIndexes, $durations, $matrixPoints),
    'exitDistance' => $exitDistance,
    'exitDuration' => $exitDuration,
    'geometry' => $route['geometry'] ?? null,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// 全件保持時は、固定終点を外す前の総座標数で12座標の境界を判定する。
$useMatrixRouting = count($cleanPoints) > 11
  || ($preserveAllPoints && count($orderedInput) > 12);

if ($useMatrixRouting) {
  // 大量配送の道路ブロック計算では、先に取り出した固定終点もMatrixへ戻す。
  // フラグなしの既存呼び出しは従来動作のままにする。
  $matrixRoutePoints = $preserveAllPoints
    ? array_merge($cleanPoints, [$endPoint])
    : $cleanPoints;
  $matrixPoints = array_merge([$start], $matrixRoutePoints);
  $matrixAttempt = call_mapbox_matrix($profile, $matrixPoints, $token);
  $matrixData = is_string($matrixAttempt['body']) ? json_decode($matrixAttempt['body'], true) : null;
  if ($matrixAttempt['body'] === false || $matrixAttempt['httpCode'] < 200 || $matrixAttempt['httpCode'] >= 300 || !is_array($matrixData) || (($matrixData['code'] ?? '') !== 'Ok')) {
    response_error_from_mapbox($matrixAttempt);
  }

  $durations = $matrixData['durations'] ?? [];
  if (!is_array($durations) || count($durations) !== count($matrixPoints)) {
    http_response_code(502);
    echo json_encode(['error' => 'Mapbox Matrix APIの応答形式が不正です'], JSON_UNESCAPED_UNICODE);
    exit;
  }

  $routeIndexes = improve_matrix_route(nearest_neighbor_matrix_route($durations, $matrixPoints), $durations, $matrixPoints);
  $orderedPoints = array_map(function($idx) use ($matrixPoints) { return $matrixPoints[$idx]; }, $routeIndexes);
  $directionsPoints = array_merge([$start], $orderedPoints);
  $directionsAttempt = call_mapbox_directions($profile, $directionsPoints, $token);
  $directionsData = is_string($directionsAttempt['body']) ? json_decode($directionsAttempt['body'], true) : null;
  if ($directionsAttempt['body'] === false || $directionsAttempt['httpCode'] < 200 || $directionsAttempt['httpCode'] >= 300 || !is_array($directionsData) || (($directionsData['code'] ?? '') !== 'Ok')) {
    response_error_from_mapbox($directionsAttempt);
  }

  $route = $directionsData['routes'][0] ?? [];
  echo json_encode([
    'ok' => true,
    'profile' => $profile,
    'method' => 'matrix-directions',
    'allPointsPreserved' => $preserveAllPoints,
    'orderedIds' => array_values(array_map(function($p) { return $p['id']; }, $orderedPoints)),
    'waypoints' => array_values(array_map(function($p, $idx) {
      return ['id' => $p['id'], 'waypoint_index' => $idx + 1, 'name' => '', 'location' => [$p['lng'], $p['lat']]];
    }, $orderedPoints, array_keys($orderedPoints))),
    'distance' => isset($route['distance']) ? (float)$route['distance'] : null,
    'duration' => isset($route['duration']) ? (float)$route['duration'] : route_matrix_cost($routeIndexes, $durations, $matrixPoints),
    'geometry' => $route['geometry'] ?? null,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$attempt = call_mapbox_optimization($profile, $coordText, $token, true, count($orderedInput));
$data = is_string($attempt['body']) ? json_decode($attempt['body'], true) : null;

// 縁側到着指定で失敗した場合は、到着側指定なしで再試行する。
if ($attempt['body'] === false || $attempt['httpCode'] < 200 || $attempt['httpCode'] >= 300 || !is_array($data) || (($data['code'] ?? '') !== 'Ok')) {
  $fallback = call_mapbox_optimization($profile, $coordText, $token, false, count($orderedInput));
  $fallbackData = is_string($fallback['body']) ? json_decode($fallback['body'], true) : null;
  if ($fallback['body'] !== false && $fallback['httpCode'] >= 200 && $fallback['httpCode'] < 300 && is_array($fallbackData) && (($fallbackData['code'] ?? '') === 'Ok')) {
    $attempt = $fallback;
    $data = $fallbackData;
  }
}

if ($attempt['body'] === false) {
  http_response_code(502);
  echo json_encode(['error' => 'Mapbox Optimization APIへの接続に失敗しました', 'detail' => $attempt['curlErr']], JSON_UNESCAPED_UNICODE);
  exit;
}

if ($attempt['httpCode'] < 200 || $attempt['httpCode'] >= 300 || !is_array($data)) {
  http_response_code(502);
  $detail = substr((string)$attempt['body'], 0, 500);
  if ($attempt['httpCode'] === 401 || $attempt['httpCode'] === 403) {
    echo json_encode([
      'error' => 'Mapboxトークンがルート検索APIで拒否されました',
      'detail' => 'MapboxのURL制限または権限設定が原因の可能性があります。api/config.php にサーバー用の MAPBOX_OPTIMIZATION_TOKEN を追加するか、Mapboxトークン設定を確認してください。応答: ' . $detail
    ], JSON_UNESCAPED_UNICODE);
    exit;
  }
  echo json_encode(['error' => 'Mapbox Optimization API応答エラー', 'detail' => $detail], JSON_UNESCAPED_UNICODE);
  exit;
}

if (($data['code'] ?? '') !== 'Ok') {
  http_response_code(502);
  echo json_encode([
    'error' => '車用ルートを計算できませんでした',
    'code' => $data['code'] ?? '',
    'detail' => $data['message'] ?? ''
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$waypoints = $data['waypoints'] ?? [];
$positions = [];
foreach ($waypoints as $inputIndex => $wp) {
  if (!isset($orderedInput[$inputIndex])) continue;
  $id = $orderedInput[$inputIndex]['id'];
  if ($id === '__start__') continue;
  $positions[] = [
    'id' => $id,
    'waypoint_index' => (int)($wp['waypoint_index'] ?? 9999),
    'name' => (string)($wp['name'] ?? ''),
    'location' => $wp['location'] ?? null,
  ];
}
usort($positions, function($a, $b) {
  return $a['waypoint_index'] <=> $b['waypoint_index'];
});

$trip = $data['trips'][0] ?? [];
echo json_encode([
  'ok' => true,
  'profile' => $profile,
  'orderedIds' => array_values(array_map(function($p) { return $p['id']; }, $positions)),
  'waypoints' => array_values($positions),
  'distance' => isset($trip['distance']) ? (float)$trip['distance'] : null,
  'duration' => isset($trip['duration']) ? (float)$trip['duration'] : null,
  'geometry' => $trip['geometry'] ?? null,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
