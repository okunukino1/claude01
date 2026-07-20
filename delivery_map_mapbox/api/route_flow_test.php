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
  echo json_encode(['error' => 'サーバー設定ファイルがありません'], JSON_UNESCAPED_UNICODE);
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
  echo json_encode(['error' => 'Mapboxルート検索トークンが未設定です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

function flow_valid_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function flow_normalize_point($value) {
  if (!is_array($value)
      || !flow_valid_coord($value['lat'] ?? null)
      || !flow_valid_coord($value['lng'] ?? null)) {
    return null;
  }
  $lat = (float)$value['lat'];
  $lng = (float)$value['lng'];
  if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) return null;
  return ['lat' => $lat, 'lng' => $lng];
}

$start = flow_normalize_point($input['start'] ?? null);
$destination = flow_normalize_point($input['destination'] ?? null);
$following = flow_normalize_point($input['following'] ?? null);
if (!$start || !$destination || !$following) {
  http_response_code(400);
  echo json_encode(['error' => '始点・1番・2番の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$heading = null;
if (isset($input['heading']) && is_numeric($input['heading'])) {
  $candidateHeading = (float)$input['heading'];
  if (is_finite($candidateHeading) && $candidateHeading >= 0 && $candidateHeading <= 360) {
    $heading = $candidateHeading;
  }
}

$maxWalkMeters = isset($input['max_walk_m']) && is_numeric($input['max_walk_m'])
  ? (float)$input['max_walk_m']
  : 60.0;
$maxWalkMeters = max(20.0, min(100.0, $maxWalkMeters));
$maxWalkingRouteMeters = max($maxWalkMeters + 35.0, $maxWalkMeters * 2.0);

function flow_request_origin() {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '' && preg_match('/^https?:\/\//i', $origin)) return $origin . '/';

  $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($referer !== '' && preg_match('/^https?:\/\//i', $referer)) return $referer;

  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  if ($host === '') return '';
  $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
  return ($https ? 'https://' : 'http://') . $host . '/';
}

function flow_call_directions($profile, $points, $token, $heading = null) {
  $coordText = implode(';', array_map(function($point) {
    return rawurlencode((string)$point['lng']) . ',' . rawurlencode((string)$point['lat']);
  }, $points));
  $params = [
    'access_token' => $token,
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'true',
    'language' => 'ja',
    'continue_straight' => 'true'
  ];
  if ($heading !== null && $profile !== 'mapbox/walking') {
    $bearings = array_fill(0, count($points), '');
    $bearings[0] = round($heading, 1) . ',45';
    $params['bearings'] = implode(';', $bearings);
  }

  $url = 'https://api.mapbox.com/directions/v5/' . $profile . '/' . $coordText . '?' . http_build_query($params);
  $ch = curl_init($url);
  $headers = ['Accept: application/json'];
  $referer = flow_request_origin();
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
    CURLOPT_TIMEOUT => 22,
    CURLOPT_HTTPHEADER => $headers,
  ]);
  $body = curl_exec($ch);
  $curlError = curl_error($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  $data = is_string($body) ? json_decode($body, true) : null;
  $route = is_array($data) ? ($data['routes'][0] ?? null) : null;
  $geometry = is_array($route) ? ($route['geometry'] ?? null) : null;
  $ok = $body !== false
    && $httpCode >= 200 && $httpCode < 300
    && is_array($data) && (($data['code'] ?? '') === 'Ok')
    && is_array($geometry) && (($geometry['type'] ?? '') === 'LineString')
    && isset($geometry['coordinates']) && is_array($geometry['coordinates'])
    && count($geometry['coordinates']) >= 2;

  return [
    'ok' => $ok,
    'profile' => $profile,
    'data' => $data,
    'route' => $route,
    'body' => $body,
    'curlError' => $curlError,
    'httpCode' => $httpCode,
  ];
}

function flow_vehicle_route($points, $token, $heading) {
  $attempts = [
    ['profile' => 'mapbox/driving-traffic', 'heading' => $heading],
    ['profile' => 'mapbox/driving-traffic', 'heading' => null],
    ['profile' => 'mapbox/driving', 'heading' => null],
  ];
  $used = [];
  $last = null;
  foreach ($attempts as $settings) {
    $key = $settings['profile'] . '|' . ($settings['heading'] === null ? '' : (string)$settings['heading']);
    if (isset($used[$key])) continue;
    $used[$key] = true;
    $attempt = flow_call_directions($settings['profile'], $points, $token, $settings['heading']);
    $last = $attempt;
    if ($attempt['ok']) return $attempt;
  }
  return $last;
}

function flow_distance_meters($a, $b) {
  $lat1 = deg2rad((float)$a['lat']);
  $lat2 = deg2rad((float)$b['lat']);
  $dLat = $lat2 - $lat1;
  $dLng = deg2rad((float)$b['lng'] - (float)$a['lng']);
  $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
  return 6371000 * 2 * atan2(sqrt($h), sqrt(max(0, 1 - $h)));
}

function flow_coord_to_point($coord) {
  return ['lng' => (float)$coord[0], 'lat' => (float)$coord[1]];
}

function flow_closest_route_point($geometry, $target) {
  $coords = $geometry['coordinates'] ?? [];
  if (count($coords) < 2) return null;
  $latScale = 111320.0;
  $lngScale = $latScale * max(0.01, cos(deg2rad((float)$target['lat'])));
  $best = null;

  for ($i = 0; $i < count($coords) - 1; $i++) {
    $a = $coords[$i];
    $b = $coords[$i + 1];
    if (!is_array($a) || !is_array($b) || count($a) < 2 || count($b) < 2) continue;
    $ax = ((float)$a[0] - $target['lng']) * $lngScale;
    $ay = ((float)$a[1] - $target['lat']) * $latScale;
    $bx = ((float)$b[0] - $target['lng']) * $lngScale;
    $by = ((float)$b[1] - $target['lat']) * $latScale;
    $dx = $bx - $ax;
    $dy = $by - $ay;
    $lengthSquared = $dx * $dx + $dy * $dy;
    $t = $lengthSquared > 0 ? max(0.0, min(1.0, -($ax * $dx + $ay * $dy) / $lengthSquared)) : 0.0;
    $x = $ax + $dx * $t;
    $y = $ay + $dy * $t;
    $distance = sqrt($x * $x + $y * $y);
    if ($best === null || $distance < $best['distance']) {
      $best = [
        'distance' => $distance,
        'segmentIndex' => $i,
        't' => $t,
        'coord' => [
          (float)$a[0] + ((float)$b[0] - (float)$a[0]) * $t,
          (float)$a[1] + ((float)$b[1] - (float)$a[1]) * $t,
        ],
      ];
    }
  }
  return $best;
}

function flow_coord_gap_meters($a, $b) {
  return flow_distance_meters(flow_coord_to_point($a), flow_coord_to_point($b));
}

function flow_append_coord(&$coords, $coord) {
  if (!is_array($coord) || count($coord) < 2) return;
  if (count($coords) && flow_coord_gap_meters($coords[count($coords) - 1], $coord) < 0.25) return;
  $coords[] = [(float)$coord[0], (float)$coord[1]];
}

function flow_split_geometry($geometry, $closest) {
  $coords = $geometry['coordinates'] ?? [];
  $index = (int)$closest['segmentIndex'];
  $stop = $closest['coord'];
  $orange = [];
  for ($i = 0; $i <= $index && $i < count($coords); $i++) flow_append_coord($orange, $coords[$i]);
  flow_append_coord($orange, $stop);

  $blue = [];
  flow_append_coord($blue, $stop);
  for ($i = $index + 1; $i < count($coords); $i++) flow_append_coord($blue, $coords[$i]);

  if (count($orange) < 2 || count($blue) < 2) return null;
  return [
    'orange' => ['type' => 'LineString', 'coordinates' => $orange],
    'blue' => ['type' => 'LineString', 'coordinates' => $blue],
  ];
}

function flow_leg_geometry($leg) {
  $coords = [];
  foreach (($leg['steps'] ?? []) as $step) {
    $stepGeometry = $step['geometry'] ?? null;
    if (!is_array($stepGeometry) || ($stepGeometry['type'] ?? '') !== 'LineString') continue;
    foreach (($stepGeometry['coordinates'] ?? []) as $coord) flow_append_coord($coords, $coord);
  }
  if (count($coords) < 2) return null;
  return ['type' => 'LineString', 'coordinates' => $coords];
}

function flow_walking_route($stop, $destination, $token) {
  $attempt = flow_call_directions('mapbox/walking', [$stop, $destination], $token, null);
  if (!$attempt || !$attempt['ok']) return null;
  $route = $attempt['route'];
  return [
    'geometry' => $route['geometry'],
    'distance' => isset($route['distance']) ? (float)$route['distance'] : null,
    'duration' => isset($route['duration']) ? (float)$route['duration'] : null,
  ];
}

function flow_bearing($a, $b) {
  $lat1 = deg2rad((float)$a[1]);
  $lat2 = deg2rad((float)$b[1]);
  $dLng = deg2rad((float)$b[0] - (float)$a[0]);
  $y = sin($dLng) * cos($lat2);
  $x = cos($lat1) * sin($lat2) - sin($lat1) * cos($lat2) * cos($dLng);
  if (abs($x) < 1e-12 && abs($y) < 1e-12) return null;
  $bearing = rad2deg(atan2($y, $x));
  return fmod($bearing + 360.0, 360.0);
}

function flow_turn_degrees($orange, $blue) {
  $a = $orange['coordinates'] ?? [];
  $b = $blue['coordinates'] ?? [];
  if (count($a) < 2 || count($b) < 2) return null;
  $arrival = flow_bearing($a[count($a) - 2], $a[count($a) - 1]);
  $departure = flow_bearing($b[0], $b[1]);
  if ($arrival === null || $departure === null) return null;
  $delta = abs($arrival - $departure);
  return $delta > 180 ? 360 - $delta : $delta;
}

// まず「現在地→2番」の自然な走行線を作り、その線が1番の徒歩圏を通るか調べる。
// 通る場合は同じ一本の線を停車候補で分割するため、オレンジと青が逆向きに重ならない。
$directAttempt = flow_vehicle_route([$start, $following], $token, $heading);
if ($directAttempt && $directAttempt['ok']) {
  $directGeometry = $directAttempt['route']['geometry'];
  $closest = flow_closest_route_point($directGeometry, $destination);
  if ($closest && $closest['distance'] <= $maxWalkMeters) {
    $stop = flow_coord_to_point($closest['coord']);
    $walking = null;
    $walkingAccepted = $closest['distance'] <= 8.0;
    if (!$walkingAccepted) {
      $walking = flow_walking_route($stop, $destination, $token);
      $walkingDistance = $walking && $walking['distance'] !== null ? $walking['distance'] : INF;
      $walkingAccepted = $walkingDistance <= $maxWalkingRouteMeters;
    }
    $split = $walkingAccepted ? flow_split_geometry($directGeometry, $closest) : null;
    if ($split) {
      $walkingGeometry = $walking ? $walking['geometry'] : [
        'type' => 'LineString',
        'coordinates' => [$closest['coord'], [$destination['lng'], $destination['lat']]],
      ];
      $walkingDistance = $walking && $walking['distance'] !== null
        ? $walking['distance']
        : $closest['distance'];
      echo json_encode([
        'ok' => true,
        'mode' => 'pass-by-walk',
        'profile' => $directAttempt['profile'],
        'orangeGeometry' => $split['orange'],
        'blueGeometry' => $split['blue'],
        'stop' => $stop,
        'walkingGeometry' => $walkingGeometry,
        'walkingDistance' => round($walkingDistance, 1),
        'buildingDistance' => round($closest['distance'], 1),
        'turnDegrees' => flow_turn_degrees($split['orange'], $split['blue']),
      ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }
  }
}

// 徒歩圏を通らない時も、1番を前後別々に検索せず、3地点を一度に検索する。
// continue_straight=true により、可能な道路では1番通過後の折り返しを避ける。
$throughAttempt = flow_vehicle_route([$start, $destination, $following], $token, $heading);
if ($throughAttempt && $throughAttempt['ok']) {
  $route = $throughAttempt['route'];
  $legs = $route['legs'] ?? [];
  $orange = isset($legs[0]) ? flow_leg_geometry($legs[0]) : null;
  $blue = isset($legs[1]) ? flow_leg_geometry($legs[1]) : null;
  $waypoints = $throughAttempt['data']['waypoints'] ?? [];
  $stopCoord = isset($waypoints[1]['location']) && is_array($waypoints[1]['location'])
    ? $waypoints[1]['location']
    : [$destination['lng'], $destination['lat']];

  if (!$orange || !$blue) {
    $closest = flow_closest_route_point($route['geometry'], flow_coord_to_point($stopCoord));
    $split = $closest ? flow_split_geometry($route['geometry'], $closest) : null;
    if ($split) {
      $orange = $split['orange'];
      $blue = $split['blue'];
    }
  }

  if ($orange && $blue) {
    $stop = flow_coord_to_point($stopCoord);
    $buildingDistance = flow_distance_meters($stop, $destination);
    $walking = $buildingDistance > 8.0 && $buildingDistance <= $maxWalkMeters
      ? flow_walking_route($stop, $destination, $token)
      : null;
    $walkingGeometry = $walking ? $walking['geometry'] : null;
    $walkingDistance = $walking && $walking['distance'] !== null ? $walking['distance'] : null;
    if ($buildingDistance > 8.0 && !$walkingGeometry) {
      $walkingGeometry = [
        'type' => 'LineString',
        'coordinates' => [$stopCoord, [$destination['lng'], $destination['lat']]],
      ];
      $walkingDistance = $buildingDistance;
    }

    echo json_encode([
      'ok' => true,
      'mode' => 'through-stop',
      'profile' => $throughAttempt['profile'],
      'orangeGeometry' => $orange,
      'blueGeometry' => $blue,
      'stop' => $stop,
      'walkingGeometry' => $walkingGeometry,
      'walkingDistance' => $walkingDistance === null ? null : round($walkingDistance, 1),
      'buildingDistance' => round($buildingDistance, 1),
      'turnDegrees' => flow_turn_degrees($orange, $blue),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
}

$lastAttempt = $throughAttempt ?: $directAttempt;
$detail = '';
if (is_array($lastAttempt)) {
  if (($lastAttempt['body'] ?? null) === false) $detail = (string)($lastAttempt['curlError'] ?? '');
  elseif (is_array($lastAttempt['data'] ?? null)) $detail = (string)($lastAttempt['data']['message'] ?? '');
}
http_response_code(502);
echo json_encode([
  'error' => '流れを優先した案内線を取得できませんでした',
  'detail' => substr($detail, 0, 300),
], JSON_UNESCAPED_UNICODE);
