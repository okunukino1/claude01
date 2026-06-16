from pathlib import Path
import re

VERSION = 'v2026.06.16-test.15'
ROOT = Path('delivery_map_mapbox')
HTML_PATH = ROOT / 'test/index.html'
API_PATH = ROOT / 'api/push_spot_completed.php'
WORKFLOW_PATH = Path('.github/workflows/use-completed-time-notice-once.yml')
SCRIPT_PATH = Path('.github/scripts/use_completed_time_notice.py')

html = HTML_PATH.read_text(encoding='utf-8-sig')
html = re.sub(r"const APP_VERSION = '[^']+';", f"const APP_VERSION = '{VERSION}';", html, count=1)

html = re.sub(
    r"function pickupCompletionTime\(d\) \{[\s\S]*?\n\}",
    lambda _: "function pickupCompletionCompletedTime(d) {\n  const completedAt = d && d.completedAt ? Number(d.completedAt) : Date.now();\n  return formatTime(completedAt);\n}",
    html,
    count=1,
)
html = html.replace('const pickupTime = pickupCompletionTime(d);', 'const completedTime = pickupCompletionCompletedTime(d);')
html = html.replace('pickup_time: pickupTime,', 'completed_time: completedTime,')
html = html.replace("time_code: spotPickupTimeCode(d.spotPickupTime || pickupTime || ''),", "time_code: spotPickupTimeCode(d.spotPickupTime || ''),")
if 'completed_time: completedTime' not in html or 'pickupCompletionTime(' in html:
    raise SystemExit('html patch verification failed')
HTML_PATH.write_text(html, encoding='utf-8', newline='\n')

api = API_PATH.read_text(encoding='utf-8-sig')
api = re.sub(
    r"  \$pickupTime = spot_completed_trim\(\$input\['pickup_time'\] \?\? '', 80\);\n  if \(\$pickupTime === ''\) \$pickupTime = \$timeCode;",
    lambda _: "  $completedTime = spot_completed_trim($input['completed_time'] ?? '', 20);\n  if ($completedTime === '') {\n    $completedAt = spot_completed_trim($input['completed_at'] ?? '', 40);\n    $timestamp = $completedAt !== '' ? strtotime($completedAt) : false;\n    $completedTime = $timestamp ? date('H:i', $timestamp) : date('H:i');\n  }",
    api,
    count=1,
)
api = api.replace(
    '$bodyParts = array_values(array_filter([$company, $pickupTime, $completedBy], function($v) {',
    '$bodyParts = array_values(array_filter([$company, $completedTime, $completedBy], function($v) {'
)
if '$completedTime' not in api or '$pickupTime' in api:
    raise SystemExit('api patch verification failed')
API_PATH.write_text(api, encoding='utf-8', newline='\n')

for path in [WORKFLOW_PATH, SCRIPT_PATH]:
    if path.exists():
        path.unlink()

print('patched completion notice to use actual completed time')
