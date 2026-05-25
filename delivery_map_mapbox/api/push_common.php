<?php

function push_cfg($name, $default = '') {
  return defined($name) ? trim((string)constant($name)) : $default;
}

function push_private_dir() {
  return dirname(__DIR__) . '/data/private';
}

function push_subscriptions_path() {
  return push_private_dir() . '/push_subscriptions.json';
}

function push_state_path() {
  return push_private_dir() . '/push_notification_state.json';
}

function push_allowed_courses() {
  return ['小舟町店', '浜町店 南', '浜町店 北'];
}

function push_sheet_course_map() {
  return [
    '小舟町店スポット' => '小舟町店',
    '浜町店 南スポット' => '浜町店 南',
    '浜町店 北スポット' => '浜町店 北',
  ];
}

function push_storage_read($path, $fallback) {
  if (!file_exists($path)) return $fallback;
  $data = json_decode((string)file_get_contents($path), true);
  return is_array($data) ? $data : $fallback;
}

function push_storage_write($path, $data) {
  $dir = dirname($path);
  if (!is_dir($dir) && !mkdir($dir, 0775, true)) {
    throw new RuntimeException('通知データ保存先を作成できません');
  }
  $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if ($json === false || file_put_contents($path, $json, LOCK_EX) === false) {
    throw new RuntimeException('通知データを書き込めません');
  }
}

function push_is_configured() {
  $publicKey = push_cfg('PUSH_VAPID_PUBLIC_KEY');
  $privateKey = push_cfg('PUSH_VAPID_PRIVATE_KEY');
  $subject = push_cfg('PUSH_VAPID_SUBJECT');
  $autoload = dirname(__DIR__) . '/vendor/autoload.php';
  return $publicKey !== '' &&
    $privateKey !== '' &&
    $subject !== '' &&
    strpos($publicKey, 'change-this') !== 0 &&
    strpos($privateKey, 'change-this') !== 0 &&
    strpos($subject, 'change-this') === false &&
    file_exists($autoload);
}

function push_filter_courses($courses) {
  if (!is_array($courses)) return [];
  $allowed = push_allowed_courses();
  $selected = [];
  foreach ($courses as $course) {
    $course = trim((string)$course);
    if (in_array($course, $allowed, true) && !in_array($course, $selected, true)) {
      $selected[] = $course;
    }
  }
  return $selected;
}

function push_subscription_id($endpoint) {
  return hash('sha256', trim((string)$endpoint));
}

function push_read_subscriptions() {
  $data = push_storage_read(push_subscriptions_path(), ['subscriptions' => []]);
  if (!isset($data['subscriptions']) || !is_array($data['subscriptions'])) {
    $data['subscriptions'] = [];
  }
  return $data;
}

function push_save_subscription($subscription, $courses) {
  $endpoint = trim((string)($subscription['endpoint'] ?? ''));
  $keys = isset($subscription['keys']) && is_array($subscription['keys']) ? $subscription['keys'] : [];
  $p256dh = trim((string)($keys['p256dh'] ?? ''));
  $auth = trim((string)($keys['auth'] ?? ''));
  if (!preg_match('#^https://#i', $endpoint) || $p256dh === '' || $auth === '') {
    throw new InvalidArgumentException('通知購読情報が正しくありません');
  }
  $selected = push_filter_courses($courses);
  if (count($selected) === 0) {
    throw new InvalidArgumentException('通知するコースを1つ以上選択してください');
  }

  $data = push_read_subscriptions();
  $id = push_subscription_id($endpoint);
  $data['subscriptions'][$id] = [
    'endpoint' => $endpoint,
    'keys' => [
      'p256dh' => $p256dh,
      'auth' => $auth,
    ],
    'expirationTime' => $subscription['expirationTime'] ?? null,
    'courses' => $selected,
    'updated_at' => date('c'),
  ];
  push_storage_write(push_subscriptions_path(), $data);
  return ['id' => $id, 'courses' => $selected];
}

function push_remove_subscription($endpoint) {
  $endpoint = trim((string)$endpoint);
  if ($endpoint === '') return false;
  $data = push_read_subscriptions();
  $id = push_subscription_id($endpoint);
  $removed = isset($data['subscriptions'][$id]);
  if ($removed) {
    unset($data['subscriptions'][$id]);
    push_storage_write(push_subscriptions_path(), $data);
  }
  return $removed;
}

function push_time_code($value) {
  $text = strtr((string)$value, [
    '０' => '0', '１' => '1', '２' => '2', '３' => '3', '４' => '4',
    '５' => '5', '６' => '6', '７' => '7', '８' => '8', '９' => '9',
  ]);
  if (preg_match('/(\d{1,2})\s*時/u', $text, $m)) {
    return 'S' . str_pad((string)(int)$m[1], 2, '0', STR_PAD_LEFT);
  }
  return 'S';
}

function push_sheet_for_item($item) {
  return trim((string)($item['spot_sheet'] ?? ''));
}

function push_course_for_sheet($sheet) {
  $map = push_sheet_course_map();
  return isset($map[$sheet]) ? $map[$sheet] : '';
}

function push_known_snapshot($items) {
  $known = [];
  foreach ($items as $item) {
    if (!is_array($item)) continue;
    $id = trim((string)($item['id'] ?? ''));
    $sheet = push_sheet_for_item($item);
    if ($id === '' || push_course_for_sheet($sheet) === '') continue;
    $known[$id] = [
      'sheet' => $sheet,
      'time_code' => push_time_code($item['time'] ?? ''),
      'cancelled' => !empty($item['cancelled']),
    ];
  }
  return $known;
}

function push_target_sheets($cache) {
  $sheets = [];
  foreach (($cache['targets'] ?? []) as $target) {
    $sheet = is_array($target) ? trim((string)($target['sheet'] ?? '')) : '';
    if ($sheet !== '' && push_course_for_sheet($sheet) !== '' && !in_array($sheet, $sheets, true)) {
      $sheets[] = $sheet;
    }
  }
  foreach (($cache['items'] ?? []) as $item) {
    $sheet = is_array($item) ? push_sheet_for_item($item) : '';
    if ($sheet !== '' && push_course_for_sheet($sheet) !== '' && !in_array($sheet, $sheets, true)) {
      $sheets[] = $sheet;
    }
  }
  return $sheets;
}

function push_default_state() {
  return [
    'ready' => false,
    'date' => '',
    'known' => [],
    'registered_sheets' => [],
    'pending' => [],
    'sent_keys' => [],
  ];
}

function push_read_state() {
  $state = push_storage_read(push_state_path(), push_default_state());
  return array_merge(push_default_state(), $state);
}

function push_event_label($type) {
  return $type === 'cancelled' ? 'キャンセル' : '新規';
}

function push_event_title($type) {
  return $type === 'cancelled' ? 'スポット集荷キャンセル' : '新しいスポット集荷';
}

function push_queue_events(&$state, $transitions, $date) {
  $groups = [];
  foreach ($transitions as $transition) {
    $groupKey = implode('|', [$transition['type'], $transition['sheet'], $transition['time_code']]);
    if (!isset($groups[$groupKey])) {
      $groups[$groupKey] = [
        'type' => $transition['type'],
        'sheet' => $transition['sheet'],
        'course' => push_course_for_sheet($transition['sheet']),
        'time_code' => $transition['time_code'],
        'ids' => [],
      ];
    }
    $groups[$groupKey]['ids'][] = $transition['id'];
  }

  $queued = 0;
  foreach ($groups as $event) {
    sort($event['ids']);
    $key = hash('sha256', implode('|', [$date, $event['type'], $event['sheet'], $event['time_code'], implode(',', $event['ids'])]));
    if (isset($state['sent_keys'][$key]) || isset($state['pending'][$key])) continue;
    $event['key'] = $key;
    $event['date'] = $date;
    $event['title'] = push_event_title($event['type']);
    $event['body'] = $event['course'] . ': ' . $event['time_code'] . ' ' . push_event_label($event['type']) . count($event['ids']) . '件';
    $event['recipients'] = null;
    $event['delivered'] = [];
    $event['created_at'] = date('c');
    $state['pending'][$key] = $event;
    $queued++;
  }
  return $queued;
}

function push_event_can_send($event, $sheetSync) {
  $sheet = (string)($event['sheet'] ?? '');
  return isset($sheetSync[$sheet]) && !empty($sheetSync[$sheet]['ok']);
}

function push_prepare_recipients(&$event, $subscriptions) {
  if (is_array($event['recipients'])) return;
  $recipients = [];
  foreach ($subscriptions as $id => $subscription) {
    $courses = push_filter_courses($subscription['courses'] ?? []);
    if (in_array($event['course'], $courses, true)) $recipients[] = (string)$id;
  }
  $event['recipients'] = $recipients;
}

function push_send_event(&$event, &$subscriptionData) {
  $subscriptions = $subscriptionData['subscriptions'];
  push_prepare_recipients($event, $subscriptions);
  $remaining = [];
  foreach ($event['recipients'] as $id) {
    if (in_array($id, $event['delivered'], true)) continue;
    if (!isset($subscriptions[$id])) {
      $event['delivered'][] = $id;
      continue;
    }
    $remaining[$id] = $subscriptions[$id];
  }
  if (count($remaining) === 0) return ['complete' => true, 'sent' => 0, 'failed' => 0];

  require_once dirname(__DIR__) . '/vendor/autoload.php';
  $auth = [
    'VAPID' => [
      'subject' => push_cfg('PUSH_VAPID_SUBJECT'),
      'publicKey' => push_cfg('PUSH_VAPID_PUBLIC_KEY'),
      'privateKey' => push_cfg('PUSH_VAPID_PRIVATE_KEY'),
    ],
  ];
  $webPush = new \Minishlink\WebPush\WebPush($auth);
  $payload = json_encode([
    'title' => $event['title'],
    'body' => $event['body'],
    'tag' => 'spot-' . substr($event['key'], 0, 16),
    'course' => $event['course'],
    'url' => './?pickup_course=' . rawurlencode($event['course']),
  ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  foreach ($remaining as $subscription) {
    $pushSubscription = \Minishlink\WebPush\Subscription::create([
      'endpoint' => $subscription['endpoint'],
      'publicKey' => $subscription['keys']['p256dh'],
      'authToken' => $subscription['keys']['auth'],
      'contentEncoding' => 'aes128gcm',
    ]);
    $webPush->queueNotification($pushSubscription, $payload, [
      'TTL' => 600,
      'urgency' => 'high',
    ]);
  }

  $sent = 0;
  $failed = 0;
  foreach ($webPush->flush() as $report) {
    $endpoint = (string)$report->getEndpoint();
    $id = push_subscription_id($endpoint);
    if ($report->isSuccess()) {
      $event['delivered'][] = $id;
      $sent++;
    } elseif ($report->isSubscriptionExpired()) {
      unset($subscriptionData['subscriptions'][$id]);
      $event['delivered'][] = $id;
    } else {
      $failed++;
    }
  }
  $event['delivered'] = array_values(array_unique($event['delivered']));
  return [
    'complete' => count(array_diff($event['recipients'], $event['delivered'])) === 0,
    'sent' => $sent,
    'failed' => $failed,
  ];
}

function push_process_spot_notifications($cache, $sheetSync) {
  $state = push_read_state();
  $date = trim((string)($cache['date'] ?? ''));
  $currentItems = isset($cache['items']) && is_array($cache['items']) ? $cache['items'] : [];
  $currentKnown = push_known_snapshot($currentItems);
  $currentSheets = push_target_sheets($cache);

  if (!push_is_configured()) {
    $state['ready'] = false;
    $state['date'] = $date;
    $state['known'] = $currentKnown;
    $state['registered_sheets'] = $currentSheets;
    $state['pending'] = [];
    $state['sent_keys'] = [];
    push_storage_write(push_state_path(), $state);
    return ['enabled' => false, 'reason' => 'Web Push設定が未完了です'];
  }

  if (empty($state['ready'])) {
    $state['ready'] = true;
    $state['date'] = $date;
    $state['known'] = $currentKnown;
    $state['registered_sheets'] = $currentSheets;
    $state['pending'] = [];
    $state['sent_keys'] = [];
    push_storage_write(push_state_path(), $state);
    return ['enabled' => true, 'baseline' => true, 'queued' => 0, 'sent' => 0];
  }

  if ($state['date'] !== $date) {
    $state['date'] = $date;
    $state['known'] = [];
    $state['pending'] = [];
    $state['sent_keys'] = [];
  }
  $newSheets = array_values(array_diff($currentSheets, $state['registered_sheets']));
  $state['registered_sheets'] = array_values(array_unique(array_merge($state['registered_sheets'], $currentSheets)));

  $transitions = [];
  foreach ($currentKnown as $id => $item) {
    if (in_array($item['sheet'], $newSheets, true)) continue;
    $old = isset($state['known'][$id]) ? $state['known'][$id] : null;
    if ($old === null && empty($item['cancelled'])) {
      $transitions[] = [
        'id' => $id,
        'sheet' => $item['sheet'],
        'time_code' => $item['time_code'],
        'type' => 'new',
      ];
    } elseif ($old !== null && empty($old['cancelled']) && !empty($item['cancelled'])) {
      $transitions[] = [
        'id' => $id,
        'sheet' => $item['sheet'],
        'time_code' => $item['time_code'],
        'type' => 'cancelled',
      ];
    }
  }
  $state['known'] = $currentKnown;
  $queued = push_queue_events($state, $transitions, $date);
  $subscriptionData = push_read_subscriptions();
  $sent = 0;
  $failed = 0;
  foreach ($state['pending'] as $key => &$event) {
    if (!push_event_can_send($event, $sheetSync)) continue;
    try {
      $result = push_send_event($event, $subscriptionData);
      $sent += (int)$result['sent'];
      $failed += (int)$result['failed'];
      if (!empty($result['complete'])) {
        $state['sent_keys'][$key] = date('c');
        unset($state['pending'][$key]);
      }
    } catch (Throwable $e) {
      $failed++;
      $event['last_error'] = $e->getMessage();
      $event['last_attempt_at'] = date('c');
    }
  }
  unset($event);
  push_storage_write(push_subscriptions_path(), $subscriptionData);
  push_storage_write(push_state_path(), $state);

  return [
    'enabled' => true,
    'queued' => $queued,
    'pending' => count($state['pending']),
    'sent' => $sent,
    'failed' => $failed,
  ];
}
