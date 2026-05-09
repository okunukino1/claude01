<?php
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=86400');

$z = isset($_GET['z']) ? (int)$_GET['z'] : -1;
$x = isset($_GET['x']) ? (int)$_GET['x'] : -1;
$y = isset($_GET['y']) ? (int)$_GET['y'] : -1;

$maxTile = (int)pow(2, max($z, 0)) - 1;
if ($z < 0 || $z > 18 || $x < 0 || $y < 0 || $x > $maxTile || $y > $maxTile) {
    http_response_code(400);
    exit;
}

$url = sprintf(
    'https://geoshape.ex.nii.ac.jp/ka/resource/ka_2020_dc/%d/%d/%d.pbf',
    $z, $x, $y
);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 8,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
]);
$body     = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($body === false || $httpCode !== 200) {
    http_response_code($httpCode ?: 503);
    exit;
}

header('Content-Type: application/x-protobuf');
echo $body;
