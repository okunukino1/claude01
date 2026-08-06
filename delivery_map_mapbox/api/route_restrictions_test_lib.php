<?php

// Test-only helpers for user-recorded directional and turn restrictions.

function rm_valid_coord($value) {
  return is_numeric($value) && is_finite((float)$value);
}

function rm_normalize_point($value) {
  if (!is_array($value)
      || !rm_valid_coord($value['lat'] ?? null)
      || !rm_valid_coord($value['lng'] ?? null)) {
    return null;
  }
  $lat = (float)$value['lat'];
  $lng = (float)$value['lng'];
  if ($lat < -90.0 || $lat > 90.0 || $lng < -180.0 || $lng > 180.0) return null;
  return ['lat' => $lat, 'lng' => $lng];
}

function rm_normalize_restrictions($value, $limit = 50) {
  if (!is_array($value)) return [];
  $result = [];
  $used = [];
  foreach ($value as $candidate) {
    if (!is_array($candidate)) continue;
    $kind = (string)($candidate['kind'] ?? '');
    $needed = $kind === 'direction' ? 2 : ($kind === 'turn' ? 3 : 0);
    if ($needed === 0 || !is_array($candidate['points'] ?? null)) continue;
    $points = [];
    foreach (array_slice($candidate['points'], 0, $needed) as $pointValue) {
      $point = rm_normalize_point($pointValue);
      if (!$point) {
        $points = [];
        break;
      }
      $points[] = $point;
    }
    if (count($points) !== $needed) continue;
    $fingerprint = $kind . ':' . implode(';', array_map(function($point) {
      return number_format($point['lat'], 6, '.', '') . ',' . number_format($point['lng'], 6, '.', '');
    }, $points));
    $id = substr((string)($candidate['id'] ?? ''), 0, 120);
    if ($id === '') $id = substr(hash('sha256', $fingerprint), 0, 20);
    $key = $kind . ':' . $id;
    if (isset($used[$key])) continue;
    $used[$key] = true;
    $result[] = ['id' => $id, 'kind' => $kind, 'points' => $points];
    if (count($result) >= max(1, min(50, (int)$limit))) break;
  }
  return $result;
}

function rm_distance_meters($a, $b) {
  $lat1 = deg2rad((float)$a['lat']);
  $lat2 = deg2rad((float)$b['lat']);
  $dLat = $lat2 - $lat1;
  $dLng = deg2rad((float)$b['lng'] - (float)$a['lng']);
  $h = sin($dLat / 2.0) ** 2
    + cos($lat1) * cos($lat2) * sin($dLng / 2.0) ** 2;
  return 6371000.0 * 2.0 * atan2(sqrt($h), sqrt(max(0.0, 1.0 - $h)));
}

function rm_coord_point($coord) {
  return ['lng' => (float)$coord[0], 'lat' => (float)$coord[1]];
}

function rm_route_projection($geometry, $target) {
  $coords = is_array($geometry) ? ($geometry['coordinates'] ?? []) : [];
  if (!is_array($coords) || count($coords) < 2) return null;
  $latScale = 111320.0;
  $lngScale = $latScale * max(0.01, cos(deg2rad((float)$target['lat'])));
  $best = null;
  $progress = 0.0;

  for ($i = 0; $i < count($coords) - 1; $i++) {
    $a = $coords[$i];
    $b = $coords[$i + 1];
    if (!is_array($a) || !is_array($b) || count($a) < 2 || count($b) < 2) continue;
    $segmentMeters = rm_distance_meters(rm_coord_point($a), rm_coord_point($b));
    $ax = ((float)$a[0] - (float)$target['lng']) * $lngScale;
    $ay = ((float)$a[1] - (float)$target['lat']) * $latScale;
    $bx = ((float)$b[0] - (float)$target['lng']) * $lngScale;
    $by = ((float)$b[1] - (float)$target['lat']) * $latScale;
    $dx = $bx - $ax;
    $dy = $by - $ay;
    $lengthSquared = $dx * $dx + $dy * $dy;
    $t = $lengthSquared > 0.0
      ? max(0.0, min(1.0, -($ax * $dx + $ay * $dy) / $lengthSquared))
      : 0.0;
    $x = $ax + $dx * $t;
    $y = $ay + $dy * $t;
    $distance = sqrt($x * $x + $y * $y);
    if ($best === null || $distance < $best['distance']) {
      $best = [
        'distance' => $distance,
        'progress' => $progress + $segmentMeters * $t,
      ];
    }
    $progress += $segmentMeters;
  }
  return $best;
}

function rm_restriction_violation($geometry, $restriction, $toleranceMeters = 32.0) {
  if (!is_array($geometry) || ($geometry['type'] ?? '') !== 'LineString') return false;
  $kind = (string)($restriction['kind'] ?? '');
  $points = $restriction['points'] ?? [];
  $needed = $kind === 'direction' ? 2 : ($kind === 'turn' ? 3 : 0);
  if ($needed === 0 || count($points) !== $needed) return false;

  $hits = [];
  foreach ($points as $point) {
    $hit = rm_route_projection($geometry, $point);
    if (!$hit || $hit['distance'] > $toleranceMeters) return false;
    $hits[] = $hit;
  }

  if ($kind === 'direction') {
    $registeredSpan = rm_distance_meters($points[0], $points[1]);
    $routeSpan = $hits[1]['progress'] - $hits[0]['progress'];
    $maxSpan = max(120.0, min(1800.0, $registeredSpan * 5.0 + 80.0));
    return $routeSpan >= 4.0 && $routeSpan <= $maxSpan;
  }

  $firstSpan = $hits[1]['progress'] - $hits[0]['progress'];
  $secondSpan = $hits[2]['progress'] - $hits[1]['progress'];
  $firstRegistered = rm_distance_meters($points[0], $points[1]);
  $secondRegistered = rm_distance_meters($points[1], $points[2]);
  $firstMax = max(90.0, min(900.0, $firstRegistered * 5.0 + 60.0));
  $secondMax = max(90.0, min(900.0, $secondRegistered * 5.0 + 60.0));
  return $firstSpan >= 3.0 && $firstSpan <= $firstMax
    && $secondSpan >= 3.0 && $secondSpan <= $secondMax;
}

function rm_route_violations($route, $restrictions) {
  $geometry = is_array($route) ? ($route['geometry'] ?? null) : null;
  $violations = [];
  foreach ($restrictions as $restriction) {
    if (rm_restriction_violation($geometry, $restriction)) {
      $violations[] = [
        'id' => (string)($restriction['id'] ?? ''),
        'kind' => (string)($restriction['kind'] ?? ''),
      ];
    }
  }
  return $violations;
}

function rm_has_point_exclusion_violation($value) {
  if (!is_array($value)) return false;
  if (($value['subtype'] ?? '') === 'pointExclusion') return true;
  foreach ($value as $child) {
    if (is_array($child) && rm_has_point_exclusion_violation($child)) return true;
  }
  return false;
}

function rm_valid_route($route) {
  $geometry = is_array($route) ? ($route['geometry'] ?? null) : null;
  return is_array($geometry)
    && ($geometry['type'] ?? '') === 'LineString'
    && is_array($geometry['coordinates'] ?? null)
    && count($geometry['coordinates']) >= 2;
}

function rm_select_safe_route($routes, $restrictions) {
  $checked = 0;
  $blockedByPoint = false;
  $violations = [];
  foreach (is_array($routes) ? $routes : [] as $index => $route) {
    if (!rm_valid_route($route)) continue;
    $checked++;
    if (rm_has_point_exclusion_violation($route)) {
      $blockedByPoint = true;
      continue;
    }
    $routeViolations = rm_route_violations($route, $restrictions);
    if (!$routeViolations) {
      return [
        'route' => $route,
        'routeIndex' => (int)$index,
        'checked' => $checked,
        'blockedByPoint' => $blockedByPoint,
        'violations' => [],
      ];
    }
    $violations = array_merge($violations, $routeViolations);
  }
  $unique = [];
  foreach ($violations as $violation) {
    $key = ($violation['kind'] ?? '') . ':' . ($violation['id'] ?? '');
    $unique[$key] = $violation;
  }
  return [
    'route' => null,
    'routeIndex' => null,
    'checked' => $checked,
    'blockedByPoint' => $blockedByPoint,
    'violations' => array_values($unique),
  ];
}

function rm_midpoint($a, $b) {
  return [
    'lat' => ((float)$a['lat'] + (float)$b['lat']) / 2.0,
    'lng' => ((float)$a['lng'] + (float)$b['lng']) / 2.0,
  ];
}

function rm_fallback_blocked_points($restrictions) {
  $result = [];
  foreach ($restrictions as $restriction) {
    $points = $restriction['points'] ?? [];
    $kind = (string)($restriction['kind'] ?? '');
    if ($kind === 'direction' && count($points) === 2) {
      $result[] = rm_midpoint($points[0], $points[1]);
    } elseif ($kind === 'turn' && count($points) === 3) {
      $result[] = rm_midpoint($points[1], $points[2]);
    }
  }
  return $result;
}

function rm_merge_blocked_points($existing, $additional, $limit = 50) {
  $result = [];
  foreach (array_merge(is_array($existing) ? $existing : [], is_array($additional) ? $additional : []) as $candidate) {
    $point = rm_normalize_point($candidate);
    if (!$point) continue;
    $key = number_format($point['lat'], 6, '.', '') . ',' . number_format($point['lng'], 6, '.', '');
    $result[$key] = $point;
    if (count($result) >= max(1, min(50, (int)$limit))) break;
  }
  return array_values($result);
}
