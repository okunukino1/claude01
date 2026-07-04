<?php
// 登記所備付地図(法務省) 筆ポリゴンタイルプロキシ
//
// amx-project (法務省地図XMLアダプトプロジェクト) が農研機構サーバーで
// 配信している PMTiles (1ファイル型タイルアーカイブ) を、Mapbox GL JS が
// 読める通常の {z}/{x}/{y} ベクタータイルとして切り出して返す。
//   - daihyo レイヤー: z2-13 (代表点)
//   - fude   レイヤー: z14-16 (筆ポリゴン, 属性に地番あり)
// PMTiles v3 仕様: ヘッダー127B + ディレクトリ(varint+gzip) + タイル本体。
// タイルIDはズーム累積 + ヒルベルト曲線順。
//
// ?debug=1 で解決過程をJSONで返す。

header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/request_guard.php';
delivery_app_set_cors_headers('GET,OPTIONS');
delivery_app_reject_disallowed_browser_origin();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

const AMX_PMTILES_URL   = 'https://habs.rad.naro.go.jp/spatial_data/amx/a.pmtiles';
const AMX_TILE_TTL      = 604800; // 7日
const AMX_DIR_TTL       = 86400;  // ヘッダー/ディレクトリは1日
const AMX_FETCH_MAX     = 16777216; // Range無視サーバー対策: 16MBで打ち切り

$z = isset($_GET['z']) ? (int)$_GET['z'] : -1;
$x = isset($_GET['x']) ? (int)$_GET['x'] : -1;
$y = isset($_GET['y']) ? (int)$_GET['y'] : -1;
$debug = !empty($_GET['debug']);

$maxTile = $z >= 0 ? (1 << $z) - 1 : -1;
if ($z < 2 || $z > 16 || $x < 0 || $y < 0 || $x > $maxTile || $y > $maxTile) {
    http_response_code(400);
    if ($debug) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'invalid_tile', 'hint' => 'z=2-16', 'z' => $z, 'x' => $x, 'y' => $y], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

$cacheDir = __DIR__ . '/cache_amx';
if (!is_dir($cacheDir)) { @mkdir($cacheDir, 0755, true); }
$cacheOk = is_dir($cacheDir) && is_writable($cacheDir);

$tileCacheFile = "{$cacheDir}/t{$z}_{$x}_{$y}.mvt";
if (!$debug && $cacheOk && is_file($tileCacheFile) && (time() - filemtime($tileCacheFile)) < AMX_TILE_TTL) {
    $body = file_get_contents($tileCacheFile);
    if ($body !== false) {
        if (strlen($body) === 0) { http_response_code(204); exit; } // 空タイルもキャッシュ
        header('Content-Type: application/x-protobuf');
        header('Cache-Control: public, max-age=604800, stale-while-revalidate=86400');
        echo $body;
        exit;
    }
}

// ---- 低レベル: HTTP Range取得 ----
function amx_range_fetch($offset, $length, &$err, &$httpCode) {
    $buf = '';
    $ch = curl_init(AMX_PMTILES_URL);
    curl_setopt_array($ch, [
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_RANGE          => $offset . '-' . ($offset + $length - 1),
        CURLOPT_USERAGENT      => 'rys-delivery-map/1.0 (+pmtiles-proxy)',
        CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$buf) {
            $buf .= $chunk;
            if (strlen($buf) > AMX_FETCH_MAX) return -1; // 打ち切り
            return strlen($chunk);
        },
    ]);
    curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);

    if ($httpCode !== 206 && $httpCode !== 200) return null;
    // サーバーがRangeを無視して200を返した場合に備える
    if ($httpCode === 200 && strlen($buf) > $length) {
        $buf = substr($buf, $offset, $length);
    }
    if (strlen($buf) < $length) {
        // 末尾のRangeでは要求より短いことがあり得る(ファイル末尾)。そのまま返す。
        if (strlen($buf) === 0) return null;
    }
    return $buf;
}

// ---- varint / ディレクトリ ----
function amx_varint($buf, &$pos, $len) {
    $result = 0; $shift = 0;
    while ($pos < $len) {
        $b = ord($buf[$pos++]);
        $result |= ($b & 0x7f) << $shift;
        if (($b & 0x80) === 0) return $result;
        $shift += 7;
        if ($shift > 63) break;
    }
    return $result;
}

function amx_parse_dir($data) {
    $len = strlen($data);
    $pos = 0;
    $n = amx_varint($data, $pos, $len);
    if ($n <= 0 || $n > 5000000) return null;
    $ids = []; $id = 0;
    for ($i = 0; $i < $n; $i++) { $id += amx_varint($data, $pos, $len); $ids[$i] = $id; }
    $runs = [];
    for ($i = 0; $i < $n; $i++) { $runs[$i] = amx_varint($data, $pos, $len); }
    $lens = [];
    for ($i = 0; $i < $n; $i++) { $lens[$i] = amx_varint($data, $pos, $len); }
    $offs = [];
    for ($i = 0; $i < $n; $i++) {
        $v = amx_varint($data, $pos, $len);
        if ($v === 0 && $i > 0) {
            $offs[$i] = $offs[$i - 1] + $lens[$i - 1];
        } else {
            $offs[$i] = $v - 1;
        }
    }
    return ['n' => $n, 'ids' => $ids, 'runs' => $runs, 'lens' => $lens, 'offs' => $offs];
}

function amx_dir_find($dir, $tid) {
    $lo = 0; $hi = $dir['n'] - 1; $best = -1;
    while ($lo <= $hi) {
        $mid = ($lo + $hi) >> 1;
        if ($dir['ids'][$mid] <= $tid) { $best = $mid; $lo = $mid + 1; }
        else { $hi = $mid - 1; }
    }
    if ($best < 0) return null;
    $run = $dir['runs'][$best];
    if ($run === 0) {
        return ['leaf' => true, 'offset' => $dir['offs'][$best], 'length' => $dir['lens'][$best]];
    }
    if ($tid < $dir['ids'][$best] + $run) {
        return ['leaf' => false, 'offset' => $dir['offs'][$best], 'length' => $dir['lens'][$best]];
    }
    return null;
}

// ---- z/x/y -> PMTiles タイルID (ヒルベルト曲線) ----
function amx_tileid($z, $x, $y) {
    $acc = intdiv((1 << (2 * $z)) - 1, 3); // 4^0 + ... + 4^(z-1)
    $rx = 0; $ry = 0; $d = 0;
    for ($s = (1 << $z) >> 1; $s > 0; $s >>= 1) {
        $rx = ($x & $s) ? 1 : 0;
        $ry = ($y & $s) ? 1 : 0;
        $d += $s * $s * ((3 * $rx) ^ $ry);
        if ($ry === 0) {
            if ($rx === 1) { $x = $s - 1 - $x; $y = $s - 1 - $y; }
            $t = $x; $x = $y; $y = $t;
        }
    }
    return $acc + $d;
}

// MVTタイル内のレイヤー名と地物数を取得 (デバッグ用)
function amx_mvt_layers($tile) {
    $layers = [];
    $len = strlen($tile);
    $pos = 0;
    while ($pos < $len) {
        $tag = amx_varint($tile, $pos, $len);
        $field = $tag >> 3;
        $wire = $tag & 7;
        if ($field === 3 && $wire === 2) {
            $l = amx_varint($tile, $pos, $len);
            $end = min($pos + $l, $len);
            $name = '';
            $count = 0;
            while ($pos < $end) {
                $t2 = amx_varint($tile, $pos, $end);
                $f2 = $t2 >> 3;
                $w2 = $t2 & 7;
                if ($w2 === 0) { amx_varint($tile, $pos, $end); continue; }
                if ($w2 === 5) { $pos += 4; continue; }
                if ($w2 === 1) { $pos += 8; continue; }
                if ($w2 === 2) {
                    $l2 = amx_varint($tile, $pos, $end);
                    if ($f2 === 1) { $name = substr($tile, $pos, $l2); }
                    if ($f2 === 2) { $count++; }
                    $pos += $l2;
                    continue;
                }
                $pos = $end;
            }
            $pos = $end;
            $layers[] = ['name' => $name, 'features' => $count];
        } else {
            if ($wire === 0) { amx_varint($tile, $pos, $len); }
            elseif ($wire === 2) { $l = amx_varint($tile, $pos, $len); $pos += $l; }
            elseif ($wire === 5) { $pos += 4; }
            elseif ($wire === 1) { $pos += 8; }
            else { break; }
        }
    }
    return $layers;
}

function amx_decompress($data, $compression) {
    if ($compression === 2) { $out = @gzdecode($data); return $out === false ? null : $out; }
    if ($compression === 1 || $compression === 0) return $data;
    return null; // brotli等は未対応
}

// ---- ヘッダー取得(キャッシュ付き) ----
function amx_get_header($cacheDir, $cacheOk, &$dbg) {
    $file = "{$cacheDir}/header.json";
    if ($cacheOk && is_file($file) && (time() - filemtime($file)) < AMX_DIR_TTL) {
        $h = json_decode(file_get_contents($file), true);
        if (is_array($h) && isset($h['rootOff'])) { $dbg['headerFrom'] = 'cache'; return $h; }
    }
    $raw = amx_range_fetch(0, 127, $err, $code);
    $dbg['headerHttp'] = $code; $dbg['headerErr'] = $err;
    if ($raw === null || strlen($raw) < 127 || substr($raw, 0, 7) !== 'PMTiles' || ord($raw[7]) !== 3) {
        return null;
    }
    $u64 = function ($at) use ($raw) { $v = unpack('P', substr($raw, $at, 8)); return $v[1]; };
    $h = [
        'rootOff'  => $u64(8),
        'rootLen'  => $u64(16),
        'leafOff'  => $u64(40),
        'leafLen'  => $u64(48),
        'tileOff'  => $u64(56),
        'tileLen'  => $u64(64),
        'internalComp' => ord($raw[97]),
        'tileComp'     => ord($raw[98]),
        'tileType'     => ord($raw[99]),
        'minZoom'      => ord($raw[100]),
        'maxZoom'      => ord($raw[101]),
    ];
    if ($cacheOk) { @file_put_contents($file, json_encode($h)); }
    $dbg['headerFrom'] = 'remote';
    return $h;
}

// ---- ルートディレクトリ(キャッシュ付き) ----
function amx_get_root_dir($h, $cacheDir, $cacheOk, &$dbg) {
    $file = "{$cacheDir}/rootdir.bin";
    if ($cacheOk && is_file($file) && (time() - filemtime($file)) < AMX_DIR_TTL) {
        $data = file_get_contents($file);
        if ($data !== false && strlen($data) > 0) { $dbg['rootFrom'] = 'cache'; return amx_parse_dir($data); }
    }
    $raw = amx_range_fetch($h['rootOff'], $h['rootLen'], $err, $code);
    $dbg['rootHttp'] = $code; $dbg['rootErr'] = $err;
    if ($raw === null) return null;
    $data = amx_decompress($raw, $h['internalComp']);
    if ($data === null) return null;
    if ($cacheOk) { @file_put_contents($file, $data); }
    $dbg['rootFrom'] = 'remote';
    return amx_parse_dir($data);
}

// ---- 解決 ----
$dbg = ['z' => $z, 'x' => $x, 'y' => $y];
$h = amx_get_header($cacheDir, $cacheOk, $dbg);
if ($h === null) {
    http_response_code(503);
    if ($debug) { header('Content-Type: application/json'); echo json_encode(['error' => 'header', 'dbg' => $dbg]); }
    exit;
}
$dbg['header'] = $h;

$tid = amx_tileid($z, $x, $y);
$dbg['tileId'] = $tid;

$dir = amx_get_root_dir($h, $cacheDir, $cacheOk, $dbg);
if ($dir === null) {
    http_response_code(503);
    if ($debug) { header('Content-Type: application/json'); echo json_encode(['error' => 'rootdir', 'dbg' => $dbg]); }
    exit;
}

$entry = amx_dir_find($dir, $tid);
$hops = 0;
while ($entry !== null && $entry['leaf'] && $hops < 4) {
    $hops++;
    // リーフディレクトリはタイル群で共有されるためキャッシュする
    $leafFile = "{$cacheDir}/leaf_{$entry['offset']}.bin";
    $data = null;
    if ($cacheOk && is_file($leafFile) && (time() - filemtime($leafFile)) < AMX_DIR_TTL) {
        $data = file_get_contents($leafFile);
        if ($data === false || $data === '') $data = null;
        else $dbg["leaf{$hops}From"] = 'cache';
    }
    if ($data === null) {
        $raw = amx_range_fetch($h['leafOff'] + $entry['offset'], $entry['length'], $err, $code);
        $dbg["leaf{$hops}Http"] = $code;
        if ($raw === null) { $entry = null; break; }
        $data = amx_decompress($raw, $h['internalComp']);
        if ($data === null) { $entry = null; break; }
        if ($cacheOk) { @file_put_contents($leafFile, $data); }
    }
    $leafDir = amx_parse_dir($data);
    if ($leafDir === null) { $entry = null; break; }
    $entry = amx_dir_find($leafDir, $tid);
}
$dbg['hops'] = $hops;

if ($entry === null || $entry['leaf']) {
    // タイルが存在しない (海上・データ未整備地域など)
    if ($cacheOk) { @file_put_contents($tileCacheFile, ''); }
    if ($debug) { header('Content-Type: application/json'); echo json_encode(['result' => 'empty', 'dbg' => $dbg]); exit; }
    http_response_code(204);
    exit;
}

$raw = amx_range_fetch($h['tileOff'] + $entry['offset'], $entry['length'], $err, $code);
$dbg['tileHttp'] = $code; $dbg['tileErr'] = $err; $dbg['tileBytes'] = $raw === null ? null : strlen($raw);
if ($raw === null) {
    http_response_code(503);
    if ($debug) { header('Content-Type: application/json'); echo json_encode(['error' => 'tiledata', 'dbg' => $dbg]); }
    exit;
}
$tile = amx_decompress($raw, $h['tileComp']);
if ($tile === null) {
    http_response_code(503);
    if ($debug) { header('Content-Type: application/json'); echo json_encode(['error' => 'decompress', 'tileComp' => $h['tileComp'], 'dbg' => $dbg]); }
    exit;
}

if ($cacheOk) { @file_put_contents($tileCacheFile, $tile); }

if ($debug) {
    header('Content-Type: application/json');
    echo json_encode([
        'result' => 'ok',
        'decompressedBytes' => strlen($tile),
        'layers' => amx_mvt_layers($tile),
        'dbg' => $dbg,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

header('Content-Type: application/x-protobuf');
header('Cache-Control: public, max-age=604800, stale-while-revalidate=86400');
echo $tile;
