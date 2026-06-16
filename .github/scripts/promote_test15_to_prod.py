from pathlib import Path
import re

ROOT = Path('delivery_map_mapbox')
PROD_VERSION = 'v2026.06.16-2'
CACHE = '20260616-2'
WORKFLOW_PATH = Path('.github/workflows/promote-test15-to-prod-once.yml')
SCRIPT_PATH = Path('.github/scripts/promote_test15_to_prod.py')

test_index = ROOT / 'test/index.html'
prod_index = ROOT / 'index.html'
text = test_index.read_text(encoding='utf-8-sig')

replacements = {
    '<title>RYS配送マップ (テスト版)</title>': '<title>RYS配送マップ</title>',
    'manifest.webmanifest?v=20260610-test-6': f'manifest.webmanifest?v={CACHE}',
    'app-icon-192.png?v=20260610-test-6': f'app-icon-192.png?v={CACHE}',
    'app-icon-512.png?v=20260610-test-6': f'app-icon-512.png?v={CACHE}',
    "'rys-mapbox-test-": "'rys-mapbox-",
    '"rys-mapbox-test-': '"rys-mapbox-',
    "const DELIVERY_SYNC_API = '../api/delivery_sync.php';": "const DELIVERY_SYNC_API = 'api/delivery_sync.php';",
    "const SHARED_GEOCODE_CACHE_API = '../api/delivery_geocode_cache_test.php';": "const SHARED_GEOCODE_CACHE_API = 'api/delivery_geocode_cache.php';",
    '../api/': 'api/',
    'RYS配送マップ テスト版': 'RYS配送マップ',
    'RYSテスト': 'RYS配送',
}
for old, new in replacements.items():
    text = text.replace(old, new)

text = re.sub(
    r'<h1>RYS配送マップ<span class="badge-test">テスト版</span><span class="app-version" id="app-version-label">[^<]+</span></h1>',
    f'<h1>RYS配送マップ<span class="app-version" id="app-version-label">{PROD_VERSION}</span></h1>',
    text,
    count=1,
)
text = re.sub(
    r'現在のバージョン: <span id="menu-app-version">[^<]+</span>',
    f'現在のバージョン: <span id="menu-app-version">{PROD_VERSION}</span>',
    text,
    count=1,
)
text = re.sub(r"const APP_VERSION = '[^']+';", f"const APP_VERSION = '{PROD_VERSION}';", text, count=1)

required = [
    "const APP_VERSION = 'v2026.06.16-2';",
    "const SPOT_COMPLETION_PUSH_API = 'api/push_spot_completed.php';",
    'function pickupCompletionCompletedTime(d)',
    'completed_time: completedTime',
    'isPickupCompletionNotificationTarget',
]
missing = [item for item in required if item not in text]
if missing:
    raise SystemExit('Production promotion missing required strings: ' + ', '.join(missing))

forbidden = [
    'rys-mapbox-test-',
    '../api/',
    'delivery_geocode_cache_test.php',
    'v2026.06.16-test',
    '<span class="badge-test">テスト版</span>',
]
found = [item for item in forbidden if item in text]
if found:
    raise SystemExit('Production index still contains test-only strings: ' + ', '.join(found))

prod_index.write_text(text, encoding='utf-8', newline='\n')

for rel in ['manifest.webmanifest', 'service-worker.js']:
    path = ROOT / rel
    if not path.exists():
        continue
    s = path.read_text(encoding='utf-8-sig')
    s = re.sub(r'app-icon-192\.png\?v=[^"\']+', f'app-icon-192.png?v={CACHE}', s)
    s = re.sub(r'app-icon-512\.png\?v=[^"\']+', f'app-icon-512.png?v={CACHE}', s)
    path.write_text(s, encoding='utf-8', newline='\n')

for path in [WORKFLOW_PATH, SCRIPT_PATH]:
    if path.exists():
        path.unlink()

print(f'promoted test app to production {PROD_VERSION}')
