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
require_once __DIR__ . '/request_guard.php';
require_once __DIR__ . '/route_restrictions_test_lib.php';
delivery_app_require_same_origin_request();

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

function flow_normalize_heading($value) {
  if (!is_numeric($value)) return null;
  $heading = (float)$value;
  if (!is_finite($heading) || $heading < 0 || $heading > 360) return null;
  return fmod($heading + 360.0, 360.0);
}

function flow_normalize_blocked_points($value) {
  if (!is_array($value)) return [];
  $points = [];
  foreach ($value as $candidate) {
    $point = flow_normalize_point($candidate);
    if (!$point) continue;
    $key = number_format($point['lat'], 7, '.', '') . ',' . number_format($point['lng'], 7, '.', '');
    $points[$key] = $point;
    if (count($points) >= 50) break;
  }
  return array_values($points);
}

function flow_point_exclusions($points) {
  return implode(',', array_map(function($point) {
    return 'point(' . number_format((float)$point['lng'], 7, '.', '') . ' '
      . number_format((float)$point['lat'], 7, '.', '') . ')';
  }, $points));
}

function flow_has_point_exclusion_violation($value) {
  if (!is_array($value)) return false;
  if (($value['subtype'] ?? '') === 'pointExclusion') return true;
  foreach ($value as $child) {
    if (is_array($child) && flow_has_point_exclusion_violation($child)) return true;
  }
  return false;
}

$start = flow_normalize_point($input['start'] ?? null);
$destination = flow_normalize_point($input['destination'] ?? null);
$following = flow_normalize_point($input['following'] ?? null);
if (!$start || !$destination || !$following) {
  http_response_code(400);
  echo json_encode(['error' => '始点・1番・2番の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$heading = flow_normalize_heading($input['heading'] ?? null);
$destinationHeading = flow_normalize_heading($input['destination_heading'] ?? null);
$followingHeading = flow_normalize_heading($input['following_heading'] ?? null);
$blockedPoints = flow_normalize_blocked_points($input['blocked_points'] ?? null);
$manualRestrictions = rm_normalize_restrictions($input['manual_restrictions'] ?? null);

$speed = isset($input['speed']) && is_numeric($input['speed'])
  ? max(0.0, min(60.0, (float)$input['speed']))
  : null;
$accuracy = isset($input['accuracy']) && is_numeric($input['accuracy'])
  ? max(0.0, min(500.0, (float)$input['accuracy']))
  : null;
$avoidManeuverRadius = $speed !== null && $speed >= 1.5
  ? max(25, min(80, (int)round(20 + $speed * 6)))
  : null;
$originSnapRadius = $accuracy !== null && $accuracy > 0 && $accuracy <= 50
  ? max(18, min(60, (int)ceil($accuracy * 1.5)))
  : null;

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

function flow_call_directions($profile, $points, $token, $pointHeadings = [], $useSafetySnap = false, $avoidManeuverRadius = null, $originSnapRadius = null, $blockedPoints = [], $alternatives = false) {
  $coordText = implode(';', array_map(function($point) {
    return rawurlencode((string)$point['lng']) . ',' . rawurlencode((string)$point['lat']);
  }, $points));
  $params = [
    'access_token' => $token,
    'geometries' => 'geojson',
    'overview' => 'full',
    'steps' => 'true',
    'language' => 'ja',
    'continue_straight' => 'true',
    'notifications' => 'all'
  ];
  if ($alternatives) $params['alternatives'] = 'true';
  if ($profile === 'mapbox/driving-traffic') $params['depart_at'] = 'now';
  if ($profile !== 'mapbox/walking' && is_array($pointHeadings) && count($pointHeadings)) {
    $bearings = array_fill(0, count($points), '');
    $hasBearing = false;
    foreach ($pointHeadings as $index => $pointHeading) {
      if (isset($bearings[$index]) && $pointHeading !== null && is_numeric($pointHeading)) {
        $bearings[$index] = round((float)$pointHeading, 1) . ',45';
        $hasBearing = true;
      }
    }
    if ($hasBearing) $params['bearings'] = implode(';', $bearings);
  }
  if ($profile !== 'mapbox/walking' && count($blockedPoints)) {
    $params['exclude'] = flow_point_exclusions($blockedPoints);
  }
  if ($profile !== 'mapbox/walking' && $useSafetySnap && $avoidManeuverRadius !== null) {
    $params['avoid_maneuver_radius'] = (string)$avoidManeuverRadius;
  }
  if ($profile !== 'mapbox/walking' && $useSafetySnap && $originSnapRadius !== null) {
    $radiuses = array_fill(0, count($points), 'unlimited');
    $radiuses[0] = (string)$originSnapRadius;
    $params['radiuses'] = implode(';', $radiuses);
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
  $routes = is_array($data) && is_array($data['routes'] ?? null) ? $data['routes'] : [];
  $route = $routes[0] ?? null;
  $ok = $body !== false
    && $httpCode >= 200 && $httpCode < 300
    && is_array($data) && (($data['code'] ?? '') === 'Ok')
    && count(array_filter($routes, 'rm_valid_route')) > 0;

  return [
    'ok' => $ok,
    'profile' => $profile,
    'data' => $data,
    'route' => $route,
    'routes' => $routes,
    'body' => $body,
    'curlError' => $curlError,
    'httpCode' => $httpCode,
  ];
}

function flow_vehicle_route($points, $token, $pointHeadings, $avoidManeuverRadius, $originSnapRadius, $blockedPoints, $manualRestrictions) {
  $startOnlyHeadings = [];
  if (isset($pointHeadings[0]) && $pointHeadings[0] !== null) $startOnlyHeadings[0] = $pointHeadings[0];
  $attempts = [
    ['profile' => 'mapbox/driving-traffic', 'headings' => $pointHeadings, 'safety' => true],
    ['profile' => 'mapbox/driving-traffic', 'headings' => $pointHeadings, 'safety' => false],
    ['profile' => 'mapbox/driving-traffic', 'headings' => $startOnlyHeadings, 'safety' => false],
    ['profile' => 'mapbox/driving-traffic', 'headings' => [], 'safety' => false],
    ['profile' => 'mapbox/driving', 'headings' => $pointHeadings, 'safety' => false],
    ['profile' => 'mapbox/driving', 'headings' => [], 'safety' => false],
  ];
  $used = [];
  $last = null;
  foreach ($attempts as $settings) {
    if ($settings['safety'] && $avoidManeuverRadius === null && $originSnapRadius === null) continue;
    $key = $settings['profile'] . '|' . json_encode($settings['headings'])
      . '|' . ($settings['safety'] ? '1' : '0');
    if (isset($used[$key])) continue;
    $used[$key] = true;
    $attempt = flow_call_directions(
      $settings['profile'],
      $points,
      $token,
      $settings['headings'],
      $settings['safety'],
      $avoidManeuverRadius,
      $originSnapRadius,
      $blockedPoints,
      count($manualRestrictions) > 0
    );
    $attempt['headingsApplied'] = $settings['headings'];
    $last = $attempt;
    if (!$attempt['ok']) continue;

    $selection = rm_select_safe_route($attempt['routes'], $manualRestrictions);
    if ($selection['route'] !== null) {
      $attempt['route'] = $selection['route'];
      $attempt['manualRestrictionCandidatesChecked'] = (int)($selection['checked'] ?? 0);
      $attempt['manualRestrictionFallbackApplied'] = false;
      $attempt['manualRestrictionUnavoidable'] = false;
      $attempt['roadMemoryApplied'] = count($blockedPoints);
      $attempt['roadMemoryUnavoidable'] = false;
      return $attempt;
    }

    if (count($manualRestrictions) > 0) {
      $fallbackPoints = rm_merge_blocked_points(
        $blockedPoints,
        rm_fallback_blocked_points($manualRestrictions),
        50
      );
      $fallback = flow_call_directions(
        $settings['profile'],
        $points,
        $token,
        $settings['headings'],
        $settings['safety'],
        $avoidManeuverRadius,
        $originSnapRadius,
        $fallbackPoints,
        true
      );
      $fallback['headingsApplied'] = $settings['headings'];
      $fallbackSelection = $fallback['ok']
        ? rm_select_safe_route($fallback['routes'], $manualRestrictions)
        : ['route' => null, 'checked' => 0];
      if ($fallbackSelection['route'] !== null) {
        $fallback['route'] = $fallbackSelection['route'];
        $fallback['manualRestrictionCandidatesChecked'] = (int)($fallbackSelection['checked'] ?? 0);
        $fallback['manualRestrictionFallbackApplied'] = true;
        $fallback['manualRestrictionUnavoidable'] = false;
        $fallback['roadMemoryApplied'] = count($fallbackPoints);
        $fallback['roadMemoryUnavoidable'] = false;
        return $fallback;
      }
      $fallback['ok'] = false;
      $fallback['manualRestrictionFallbackApplied'] = true;
      $fallback['manualRestrictionUnavoidable'] = true;
      $fallback['roadMemoryApplied'] = count($fallbackPoints);
      $fallback['roadMemoryUnavoidable'] = true;
      return $fallback;
    }

    $attempt['ok'] = false;
    $attempt['manualRestrictionFallbackApplied'] = false;
    $attempt['manualRestrictionUnavoidable'] = false;
    $attempt['roadMemoryApplied'] = count($blockedPoints);
    $attempt['roadMemoryUnavoidable'] = count($blockedPoints) > 0;
    return $attempt;
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
  $attempt = flow_call_directions('mapbox/walking', [$stop, $destination], $token, []);
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

function flow_heading_difference($a, $b) {
  if ($a === null || $b === null) return INF;
  $delta = abs((float)$a - (float)$b);
  return $delta > 180.0 ? 360.0 - $delta : $delta;
}

function flow_closest_route_heading($geometry, $closest) {
  $coords = $geometry['coordinates'] ?? [];
  $index = isset($closest['segmentIndex']) ? (int)$closest['segmentIndex'] : -1;
  if ($index < 0 || $index + 1 >= count($coords)) return null;
  $heading = flow_bearing($coords[$index], $coords[$index + 1]);
  if ($heading !== null) return $heading;
  for ($offset = 1; $offset < 4; $offset++) {
    $before = $index - $offset;
    if ($before >= 0) {
      $heading = flow_bearing($coords[$before], $coords[$before + 1]);
      if ($heading !== null) return $heading;
    }
    $after = $index + $offset;
    if ($after >= 0 && $after + 1 < count($coords)) {
      $heading = flow_bearing($coords[$after], $coords[$after + 1]);
      if ($heading !== null) return $heading;
    }
  }
  return null;
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
$directAttempt = flow_vehicle_route(
  [$start, $following],
  $token,
  [0 => $heading, 1 => $followingHeading],
  $avoidManeuverRadius,
  $originSnapRadius,
  $blockedPoints,
  $manualRestrictions
);
if ($directAttempt && $directAttempt['ok']) {
  $directGeometry = $directAttempt['route']['geometry'];
  $closest = flow_closest_route_point($directGeometry, $destination);
  $closestHeading = $closest ? flow_closest_route_heading($directGeometry, $closest) : null;
  $approachHeadingMatches = $destinationHeading === null
    || flow_heading_difference($closestHeading, $destinationHeading) <= 60.0;
  if ($closest && $closest['distance'] <= $maxWalkMeters && $approachHeadingMatches) {
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
        'destinationHeadingApplied' => $destinationHeading !== null,
        'followingHeadingApplied' => $followingHeading !== null
          && isset($directAttempt['headingsApplied'][1]),
        'roadMemoryApplied' => (int)($directAttempt['roadMemoryApplied'] ?? count($blockedPoints)),
        'roadMemoryUnavoidable' => false,
        'manualRestrictionsApplied' => count($manualRestrictions),
        'manualRestrictionCandidatesChecked' => (int)($directAttempt['manualRestrictionCandidatesChecked'] ?? 0),
        'manualRestrictionFallbackApplied' => (bool)($directAttempt['manualRestrictionFallbackApplied'] ?? false),
        'manualRestrictionUnavoidable' => false,
      ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }
  }
}

// 徒歩圏を通らない時も、1番を前後別々に検索せず、3地点を一度に検索する。
// continue_straight=true により、可能な道路では1番通過後の折り返しを避ける。
$throughAttempt = flow_vehicle_route(
  [$start, $destination, $following],
  $token,
  [0 => $heading, 1 => $destinationHeading, 2 => $followingHeading],
  $avoidManeuverRadius,
  $originSnapRadius,
  $blockedPoints,
  $manualRestrictions
);
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
      'destinationHeadingApplied' => $destinationHeading !== null
        && isset($throughAttempt['headingsApplied'][1]),
      'followingHeadingApplied' => $followingHeading !== null
        && isset($throughAttempt['headingsApplied'][2]),
      'roadMemoryApplied' => (int)($throughAttempt['roadMemoryApplied'] ?? count($blockedPoints)),
      'roadMemoryUnavoidable' => false,
      'manualRestrictionsApplied' => count($manualRestrictions),
      'manualRestrictionCandidatesChecked' => (int)($throughAttempt['manualRestrictionCandidatesChecked'] ?? 0),
      'manualRestrictionFallbackApplied' => (bool)($throughAttempt['manualRestrictionFallbackApplied'] ?? false),
      'manualRestrictionUnavoidable' => false,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
}

$lastAttempt = $throughAttempt ?: $directAttempt;
$restrictionUnavoidable = (bool)(($throughAttempt['manualRestrictionUnavoidable'] ?? false)
  || ($directAttempt['manualRestrictionUnavoidable'] ?? false));
$roadMemoryUnavoidable = (bool)(($throughAttempt['roadMemoryUnavoidable'] ?? false)
  || ($directAttempt['roadMemoryUnavoidable'] ?? false));
if ($restrictionUnavoidable || $roadMemoryUnavoidable) {
  http_response_code(409);
  echo json_encode([
    'error' => '登録した通行規制を避けられる安全な経路がありません',
    'roadMemoryApplied' => count($blockedPoints),
    'roadMemoryUnavoidable' => $roadMemoryUnavoidable,
    'manualRestrictionsApplied' => count($manualRestrictions),
    'manualRestrictionFallbackApplied' => $restrictionUnavoidable,
    'manualRestrictionUnavoidable' => $restrictionUnavoidable,
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}
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
