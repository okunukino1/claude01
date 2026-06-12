<?php

function delivery_app_host_only($host) {
  $host = strtolower(trim((string)$host));
  if ($host === '') return '';

  if ($host[0] === '[') {
    $end = strpos($host, ']');
    return $end === false ? trim($host, '[]') : substr($host, 1, $end - 1);
  }

  if (substr_count($host, ':') === 1) {
    $host = substr($host, 0, strpos($host, ':'));
  }

  return trim($host, '.');
}

function delivery_app_allowed_hosts() {
  $hosts = ['rys-services.com', 'www.rys-services.com', 'localhost', '127.0.0.1', '::1'];

  if (defined('APP_ALLOWED_HOSTS')) {
    $configured = APP_ALLOWED_HOSTS;
    if (is_string($configured)) {
      $configured = array_map('trim', explode(',', $configured));
    }
    if (is_array($configured)) {
      $hosts = array_merge($hosts, $configured);
    }
  }

  $currentHost = delivery_app_host_only($_SERVER['HTTP_HOST'] ?? '');
  if ($currentHost !== '') {
    $hosts[] = $currentHost;
  }

  $normalized = [];
  foreach ($hosts as $host) {
    $host = delivery_app_host_only($host);
    if ($host !== '') {
      $normalized[$host] = true;
    }
  }

  return array_keys($normalized);
}

function delivery_app_url_host($url) {
  $host = parse_url((string)$url, PHP_URL_HOST);
  return delivery_app_host_only($host ?: '');
}

function delivery_app_is_allowed_url($url) {
  $scheme = strtolower((string)parse_url((string)$url, PHP_URL_SCHEME));
  if ($scheme !== 'http' && $scheme !== 'https') return false;

  $host = delivery_app_url_host($url);
  return $host !== '' && in_array($host, delivery_app_allowed_hosts(), true);
}

function delivery_app_set_cors_headers($methods = 'GET,POST,OPTIONS') {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '' && delivery_app_is_allowed_url($origin)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: ' . $methods);
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 86400');
  }
}

function delivery_app_fail_forbidden() {
  http_response_code(403);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode(['error' => 'このアプリからのリクエストのみ受け付けます'], JSON_UNESCAPED_UNICODE);
  exit;
}

function delivery_app_require_same_origin_request() {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '') {
    if (!delivery_app_is_allowed_url($origin)) delivery_app_fail_forbidden();
    return;
  }

  $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($referer !== '') {
    if (!delivery_app_is_allowed_url($referer)) delivery_app_fail_forbidden();
    return;
  }

  delivery_app_fail_forbidden();
}

function delivery_app_reject_disallowed_browser_origin() {
  $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? '');
  if ($origin !== '' && !delivery_app_is_allowed_url($origin)) {
    delivery_app_fail_forbidden();
  }

  $referer = (string)($_SERVER['HTTP_REFERER'] ?? '');
  if ($referer !== '' && !delivery_app_is_allowed_url($referer)) {
    delivery_app_fail_forbidden();
  }
}
