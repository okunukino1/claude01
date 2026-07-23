<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
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
delivery_app_require_same_origin_request();

$key = '';
if (defined('GOOGLE_ROUTES_API_KEY') && GOOGLE_ROUTES_API_KEY) {
  $key = trim((string)GOOGLE_ROUTES_API_KEY);
} elseif (defined('GOOGLE_MAPS_SERVER_KEY') && GOOGLE_MAPS_SERVER_KEY) {
  $key = trim((string)GOOGLE_MAPS_SERVER_KEY);
}

if ($key === '' || $key === 'AIza...Google Geocoding API用キー...') {
  http_response_code(500);
  echo json_encode([
    'error' => 'Google Routes APIキーが未設定です',
    'hint' => 'api/config.php の GOOGLE_ROUTES_API_KEY を確認してください。',
  ], JSON_UNESCAPED_UNICODE);
  exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
  http_response_code(400);
  echo json_encode(['error' => 'JSON形式のリクエストではありません'], JSON_UNESCAPED_UNICODE);
  exit;
}

function google_guidance_valid_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function google_guidance_point($value) {
  if (!is_array($value)
      || !google_guidance_valid_coord($value['lat'] ?? null)
      || !google_guidance_valid_coord($value['lng'] ?? null)) {
    return null;
  }
  $lat = (float)$value['lat'];
  $lng = (float)$value['lng'];
  if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) return null;
  return ['lat' => $lat, 'lng' => $lng];
}

function google_guidance_heading($value) {
  if (!is_numeric($value)) return null;
  $heading = (float)$value;
  if (!is_finite($heading) || $heading < 0 || $heading > 360) return null;
  return ((int)round($heading)) % 360;
}

function google_guidance_waypoint($point, $heading = null, $vehicleStopover = false) {
  $location = [
    'latLng' => [
      'latitude' => (float)$point['lat'],
      'longitude' => (float)$point['lng'],
    ],
  ];
  if ($heading !== null) $location['heading'] = (int)$heading;

  $waypoint = ['location' => $location];
  if ($vehicleStopover) $waypoint['vehicleStopover'] = true;
  return $waypoint;
}

function google_guidance_duration_seconds($value) {
  if (!is_string($value) || !preg_match('/^([0-9]+(?:\.[0-9]+)?)s$/', $value, $matches)) return null;
  return (float)$matches[1];
}

function google_guidance_geometry($value) {
  if (!is_array($value)) return null;
  $coordinates = $value['coordinates'] ?? null;
  if (!is_array($coordinates) || count($coordinates) < 2) return null;
  return [
    'type' => 'LineString',
    'coordinates' => array_values($coordinates),
  ];
}

function google_guidance_call($key, $payload, $fieldMask) {
  $ch = curl_init('https://routes.googleapis.com/directions/v2:computeRoutes');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
      'Content-Type: application/json; charset=utf-8',
      'X-Goog-Api-Key: ' . $key,
      'X-Goog-FieldMask: ' . $fieldMask,
    ],
    CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
  ]);
  $body = curl_exec($ch);
  $curlError = curl_error($ch);
  $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);

  $data = is_string($body) ? json_decode($body, true) : null;
  $route = is_array($data) ? ($data['routes'][0] ?? null) : null;
  $geometry = is_array($route)
    ? google_guidance_geometry($route['polyline']['geoJsonLinestring'] ?? null)
    : null;
  $ok = $body !== false
    && $httpCode >= 200 && $httpCode < 300
    && is_array($route)
    && $geometry !== null;

  $message = '';
  if (is_array($data) && is_array($data['error'] ?? null)) {
    $message = (string)($data['error']['message'] ?? '');
  }

  return [
    'ok' => $ok,
    'route' => $route,
    'geometry' => $geometry,
    'httpCode' => $httpCode,
    'curlError' => $curlError,
    'message' => $message,
  ];
}

function google_guidance_drive_route($key, $start, $destination, $heading, $intermediate = null) {
  $payload = [
    'origin' => google_guidance_waypoint($start, $heading, false),
    'destination' => google_guidance_waypoint($destination, null, true),
    'travelMode' => 'DRIVE',
    'routingPreference' => 'TRAFFIC_AWARE_OPTIMAL',
    'computeAlternativeRoutes' => false,
    'routeModifiers' => [
      'avoidTolls' => false,
      'avoidHighways' => false,
      'avoidFerries' => false,
    ],
    'polylineQuality' => 'HIGH_QUALITY',
    'polylineEncoding' => 'GEO_JSON_LINESTRING',
    'languageCode' => 'ja',
    'regionCode' => 'JP',
    'units' => 'METRIC',
  ];
  if ($intermediate !== null) {
    $payload['intermediates'] = [
      google_guidance_waypoint($intermediate, null, true),
    ];
  }

  $fieldMask = implode(',', [
    'routes.distanceMeters',
    'routes.duration',
    'routes.polyline.geoJsonLinestring',
    'routes.legs.distanceMeters',
    'routes.legs.duration',
    'routes.legs.polyline.geoJsonLinestring',
    'routes.legs.startLocation',
    'routes.legs.endLocation',
  ]);
  $attempt = google_guidance_call($key, $payload, $fieldMask);
  if ($attempt['ok']) return $attempt;

  // 一部のプロジェクト設定で終点のvehicleStopoverが受理されない場合も、
  // 中間の配送先だけは停車地点として維持して再試行する。
  unset($payload['destination']['vehicleStopover']);
  return google_guidance_call($key, $payload, $fieldMask);
}

function google_guidance_walk_route($key, $start, $destination) {
  $payload = [
    'origin' => google_guidance_waypoint($start),
    'destination' => google_guidance_waypoint($destination),
    'travelMode' => 'WALK',
    'polylineQuality' => 'HIGH_QUALITY',
    'polylineEncoding' => 'GEO_JSON_LINESTRING',
    'languageCode' => 'ja',
    'regionCode' => 'JP',
    'units' => 'METRIC',
  ];
  return google_guidance_call(
    $key,
    $payload,
    'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring'
  );
}

function google_guidance_distance_meters($a, $b) {
  $lat1 = deg2rad((float)$a['lat']);
  $lat2 = deg2rad((float)$b['lat']);
  $dLat = $lat2 - $lat1;
  $dLng = deg2rad((float)$b['lng'] - (float)$a['lng']);
  $h = sin($dLat / 2) ** 2 + cos($lat1) * cos($lat2) * sin($dLng / 2) ** 2;
  return 6371000 * 2 * atan2(sqrt($h), sqrt(max(0, 1 - $h)));
}

function google_guidance_coord_to_point($coord) {
  return ['lng' => (float)$coord[0], 'lat' => (float)$coord[1]];
}

function google_guidance_closest_route_point($geometry, $target) {
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
    $t = $lengthSquared > 0
      ? max(0.0, min(1.0, -($ax * $dx + $ay * $dy) / $lengthSquared))
      : 0.0;
    $x = $ax + $dx * $t;
    $y = $ay + $dy * $t;
    $distance = sqrt($x * $x + $y * $y);
    if ($best === null || $distance < $best['distance']) {
      $best = [
        'distance' => $distance,
        'segmentIndex' => $i,
        'coord' => [
          (float)$a[0] + ((float)$b[0] - (float)$a[0]) * $t,
          (float)$a[1] + ((float)$b[1] - (float)$a[1]) * $t,
        ],
      ];
    }
  }
  return $best;
}

function google_guidance_append_coord(&$coords, $coord) {
  if (!is_array($coord) || count($coord) < 2) return;
  if (count($coords)) {
    $last = google_guidance_coord_to_point($coords[count($coords) - 1]);
    $next = google_guidance_coord_to_point($coord);
    if (google_guidance_distance_meters($last, $next) < 0.25) return;
  }
  $coords[] = [(float)$coord[0], (float)$coord[1]];
}

function google_guidance_split_geometry($geometry, $closest) {
  $coords = $geometry['coordinates'] ?? [];
  $index = (int)$closest['segmentIndex'];
  $stop = $closest['coord'];
  $orange = [];
  for ($i = 0; $i <= $index && $i < count($coords); $i++) {
    google_guidance_append_coord($orange, $coords[$i]);
  }
  google_guidance_append_coord($orange, $stop);

  $blue = [];
  google_guidance_append_coord($blue, $stop);
  for ($i = $index + 1; $i < count($coords); $i++) {
    google_guidance_append_coord($blue, $coords[$i]);
  }
  if (count($orange) < 2 || count($blue) < 2) return null;
  return [
    'orange' => ['type' => 'LineString', 'coordinates' => $orange],
    'blue' => ['type' => 'LineString', 'coordinates' => $blue],
  ];
}

function google_guidance_leg_geometry($leg) {
  if (!is_array($leg)) return null;
  return google_guidance_geometry($leg['polyline']['geoJsonLinestring'] ?? null);
}

function google_guidance_leg_end($leg, $fallback) {
  $latLng = is_array($leg) ? ($leg['endLocation']['latLng'] ?? null) : null;
  if (!is_array($latLng)
      || !google_guidance_valid_coord($latLng['latitude'] ?? null)
      || !google_guidance_valid_coord($latLng['longitude'] ?? null)) {
    return $fallback;
  }
  return [
    'lat' => (float)$latLng['latitude'],
    'lng' => (float)$latLng['longitude'],
  ];
}

function google_guidance_bearing($a, $b) {
  $lat1 = deg2rad((float)$a[1]);
  $lat2 = deg2rad((float)$b[1]);
  $dLng = deg2rad((float)$b[0] - (float)$a[0]);
  $y = sin($dLng) * cos($lat2);
  $x = cos($lat1) * sin($lat2) - sin($lat1) * cos($lat2) * cos($dLng);
  if (abs($x) < 1e-12 && abs($y) < 1e-12) return null;
  return fmod(rad2deg(atan2($y, $x)) + 360.0, 360.0);
}

function google_guidance_turn_degrees($orange, $blue) {
  $a = $orange['coordinates'] ?? [];
  $b = $blue['coordinates'] ?? [];
  if (count($a) < 2 || count($b) < 2) return null;
  $arrival = google_guidance_bearing($a[count($a) - 2], $a[count($a) - 1]);
  $departure = google_guidance_bearing($b[0], $b[1]);
  if ($arrival === null || $departure === null) return null;
  $delta = abs($arrival - $departure);
  return $delta > 180 ? 360 - $delta : $delta;
}

$start = google_guidance_point($input['start'] ?? null);
$destination = google_guidance_point($input['destination'] ?? null);
$following = google_guidance_point($input['following'] ?? null);
$heading = google_guidance_heading($input['heading'] ?? null);
if (!$start || !$destination) {
  http_response_code(400);
  echo json_encode(['error' => '始点または目的地の緯度経度が不正です'], JSON_UNESCAPED_UNICODE);
  exit;
}

$maxWalkMeters = isset($input['max_walk_m']) && is_numeric($input['max_walk_m'])
  ? (float)$input['max_walk_m']
  : 60.0;
$maxWalkMeters = max(20.0, min(100.0, $maxWalkMeters));
$maxWalkingRouteMeters = max($maxWalkMeters + 35.0, $maxWalkMeters * 2.0);

if (!$following) {
  $single = google_guidance_drive_route($key, $start, $destination, $heading);
  if ($single['ok']) {
    $route = $single['route'];
    $legs = $route['legs'] ?? [];
    $orange = isset($legs[0]) ? google_guidance_leg_geometry($legs[0]) : null;
    if (!$orange) $orange = $single['geometry'];
    $stop = google_guidance_leg_end($legs[0] ?? null, $destination);
    $buildingDistance = google_guidance_distance_meters($stop, $destination);
    $walkingGeometry = $buildingDistance >= 5.0
      ? [
        'type' => 'LineString',
        'coordinates' => [[$stop['lng'], $stop['lat']], [$destination['lng'], $destination['lat']]],
      ]
      : null;
    echo json_encode([
      'ok' => true,
      'provider' => 'google',
      'mode' => 'single',
      'profile' => 'google/routes-drive-optimal',
      'orangeGeometry' => $orange,
      'blueGeometry' => null,
      'stop' => $stop,
      'walkingGeometry' => $walkingGeometry,
      'walkingDistance' => $walkingGeometry ? round($buildingDistance, 1) : null,
      'buildingDistance' => round($buildingDistance, 1),
      'distance' => isset($route['distanceMeters']) ? (float)$route['distanceMeters'] : null,
      'duration' => google_guidance_duration_seconds($route['duration'] ?? ''),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
  }
  $lastAttempt = $single;
} else {
  // 2番への自然なGoogle経路が1番の徒歩圏を通る時は、その道上で停車する。
  $direct = google_guidance_drive_route($key, $start, $following, $heading);
  if ($direct['ok']) {
    $closest = google_guidance_closest_route_point($direct['geometry'], $destination);
    if ($closest && $closest['distance'] <= $maxWalkMeters) {
      $stop = google_guidance_coord_to_point($closest['coord']);
      $walking = null;
      $walkingAccepted = $closest['distance'] <= 8.0;
      if (!$walkingAccepted) {
        $walking = google_guidance_walk_route($key, $stop, $destination);
        $walkingDistance = $walking['ok'] && isset($walking['route']['distanceMeters'])
          ? (float)$walking['route']['distanceMeters']
          : INF;
        $walkingAccepted = $walkingDistance <= $maxWalkingRouteMeters;
      }
      $split = $walkingAccepted
        ? google_guidance_split_geometry($direct['geometry'], $closest)
        : null;
      if ($split) {
        $walkingGeometry = $walking && $walking['ok']
          ? $walking['geometry']
          : [
            'type' => 'LineString',
            'coordinates' => [$closest['coord'], [$destination['lng'], $destination['lat']]],
          ];
        $walkingDistance = $walking && $walking['ok']
          ? (float)($walking['route']['distanceMeters'] ?? $closest['distance'])
          : $closest['distance'];
        echo json_encode([
          'ok' => true,
          'provider' => 'google',
          'mode' => 'pass-by-walk',
          'profile' => 'google/routes-drive-optimal',
          'orangeGeometry' => $split['orange'],
          'blueGeometry' => $split['blue'],
          'stop' => $stop,
          'walkingGeometry' => $walkingGeometry,
          'walkingDistance' => round($walkingDistance, 1),
          'buildingDistance' => round($closest['distance'], 1),
          'turnDegrees' => google_guidance_turn_degrees($split['orange'], $split['blue']),
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
      }
    }
  }

  $through = google_guidance_drive_route($key, $start, $following, $heading, $destination);
  if ($through['ok']) {
    $route = $through['route'];
    $legs = $route['legs'] ?? [];
    $orange = isset($legs[0]) ? google_guidance_leg_geometry($legs[0]) : null;
    $blue = isset($legs[1]) ? google_guidance_leg_geometry($legs[1]) : null;
    if ($orange && $blue) {
      $stop = google_guidance_leg_end($legs[0], $destination);
      $buildingDistance = google_guidance_distance_meters($stop, $destination);
      $walkingGeometry = $buildingDistance >= 5.0
        ? [
          'type' => 'LineString',
          'coordinates' => [[$stop['lng'], $stop['lat']], [$destination['lng'], $destination['lat']]],
        ]
        : null;
      echo json_encode([
        'ok' => true,
        'provider' => 'google',
        'mode' => 'through-stop',
        'profile' => 'google/routes-drive-optimal',
        'orangeGeometry' => $orange,
        'blueGeometry' => $blue,
        'stop' => $stop,
        'walkingGeometry' => $walkingGeometry,
        'walkingDistance' => $walkingGeometry ? round($buildingDistance, 1) : null,
        'buildingDistance' => round($buildingDistance, 1),
        'turnDegrees' => google_guidance_turn_degrees($orange, $blue),
      ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      exit;
    }
  }
  $lastAttempt = $through['ok'] ? $through : $direct;
}

$detail = '';
if (is_array($lastAttempt ?? null)) {
  $detail = (string)($lastAttempt['message'] ?? '');
  if ($detail === '') $detail = (string)($lastAttempt['curlError'] ?? '');
}
http_response_code(502);
echo json_encode([
  'error' => 'Google案内線を取得できませんでした',
  'detail' => substr($detail, 0, 300),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
