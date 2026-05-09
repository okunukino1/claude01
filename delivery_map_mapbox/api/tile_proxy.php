<?php
header('Access-Control-Allow-Origin: *');

$z = isset($_GET['z']) ? (int)$_GET['z'] : -1;
$x = isset($_GET['x']) ? (int)$_GET['x'] : -1;
$y = isset($_GET['y']) ? (int)$_GET['y'] : -1;

// ?debug=1 で診断情報をJSONで返す
$debug = !empty($_GET['debug']);

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
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => [
        'Accept: application/x-protobuf,application/octet-stream,*/*',
        'Accept-Language: ja,en;q=0.9',
        'Referer: https://geoshape.ex.nii.ac.jp/ka/',
    ],
]);
$body     = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($debug) {
    header('Content-Type: application/json');
    echo json_encode([
        'url'      => $url,
        'httpCode' => $httpCode,
        'curlErr'  => $curlErr,
        'bodyLen'  => $body !== false ? strlen($body) : null,
    ]);
    exit;
}

if ($body === false || $httpCode !== 200) {
    http_response_code($httpCode ?: 503);
    exit;
}

header('Content-Type: application/x-protobuf');
header('Cache-Control: public, max-age=86400');
echo $body;
