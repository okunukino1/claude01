<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

require __DIR__ . '/config.php';

// ブラウザに渡すのは Mapbox公開トークン (pk.*) と地図スタイルのみ。
// Geminiキーや Google Geocoding キーはここでは絶対に返さない。
echo json_encode([
    'mapboxAccessToken' => defined('MAPBOX_ACCESS_TOKEN') ? MAPBOX_ACCESS_TOKEN : '',
    'mapboxStyle'       => defined('MAPBOX_STYLE') ? MAPBOX_STYLE : 'mapbox://styles/mapbox/standard',
], JSON_UNESCAPED_UNICODE);
