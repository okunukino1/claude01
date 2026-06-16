from pathlib import Path
import re

VERSION = 'v2026.06.16-test.14'
ROOT = Path('delivery_map_mapbox')
HTML_PATH = ROOT / 'test/index.html'
API_PATH = ROOT / 'api/push_spot_completed.php'
WORKFLOW_PATH = Path('.github/workflows/update-pickup-completion-notice-once.yml')
SCRIPT_PATH = Path('.github/scripts/update_pickup_completion_notice.py')

html = HTML_PATH.read_text(encoding='utf-8-sig')
html = re.sub(r"const APP_VERSION = '[^']+';", f"const APP_VERSION = '{VERSION}';", html, count=1)

new_notify = r'''
function isPickupCompletionNotificationTarget(d) {
  return !!(d && (isSpotPickupDelivery(d) || (isPickupBackedDelivery(d) && isPickupListSpotDelivery(d))));
}

function pickupCompletionCompany(d) {
  const display = isPickupBackedDelivery(d) ? pickupListDisplay(d) : null;
  return String(d.spotPickupCompany || d.pickupCompany || (display && display.company) || '').trim() || '集荷先';
}

function pickupCompletionTime(d) {
  const direct = normalizePickupTime(d.spotPickupTime || d.pickupTime || d.time || '');
  if (direct) return direct;
  const lines = String(d.note || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^(?:時間|希望時間帯)[:：]\s*(.+)$/);
    if (match && match[1]) return normalizePickupTime(match[1]);
  }
  return '';
}

function notifySpotPickupCompleted(d, operatorName) {
  if (!isPickupCompletionNotificationTarget(d) || !d.completed) return;
  const course = spotPickupCourseForDelivery(d);
  if (!course) return;
  const company = pickupCompletionCompany(d);
  const pickupTime = pickupCompletionTime(d);
  const payload = {
    course,
    company,
    pickup_time: pickupTime,
    time_code: spotPickupTimeCode(d.spotPickupTime || pickupTime || ''),
    completed_by: operatorName || d.completedBy || '',
    spot_pickup_id: d.spotPickupId || pickupProgressKey(d) || d.pickupId || d.id || '',
    spot_pickup_date: d.spotPickupDate || '',
    natural_key: spotPickupNaturalKey(d),
    address: d.address || '',
    completed_at: localIsoString(d.completedAt || Date.now())
  };
  fetch(SPOT_COMPLETION_PUSH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(async res => {
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || (data && data.ok === false)) {
      console.warn('spot completion push failed', data.error || res.status);
    }
  }).catch(e => console.warn('spot completion push failed', e));
}
'''.strip()

pattern = r"function notifySpotPickupCompleted\(d, operatorName\) \{[\s\S]*?\n\}"
if 'function isPickupCompletionNotificationTarget(' not in html:
    matches = re.findall(pattern, html)
    if len(matches) != 1:
        raise SystemExit(f'expected one notify function, found {len(matches)}')
    html = re.sub(pattern, new_notify, html, count=1)
else:
    start = html.index('function isPickupCompletionNotificationTarget(')
    end_marker = "\n\nfunction dedupeSpotPickupItems(items) {"
    end = html.index(end_marker, start)
    html = html[:start] + new_notify + html[end:]

html = html.replace(
    'if (nextCompleted && isSpotPickupDelivery(d)) notifySpotPickupCompleted(d, operatorName);',
    'if (nextCompleted && isPickupCompletionNotificationTarget(d)) notifySpotPickupCompleted(d, operatorName);'
)

HTML_PATH.write_text(html, encoding='utf-8', newline='\n')

api = API_PATH.read_text(encoding='utf-8-sig')
if "$pickupTime = spot_completed_trim($input['pickup_time'] ?? '', 80);" not in api:
    api = re.sub(
        r"  \$timeCode = spot_completed_trim\(\$input\['time_code'\] \?\? '', 20\);\n  \$completedBy = spot_completed_trim\(\$input\['completed_by'\] \?\? '', 60\);",
        "  $timeCode = spot_completed_trim($input['time_code'] ?? '', 20);\n  $pickupTime = spot_completed_trim($input['pickup_time'] ?? '', 80);\n  if ($pickupTime === '') $pickupTime = $timeCode;\n  $completedBy = spot_completed_trim($input['completed_by'] ?? '', 60);",
        api,
        count=1,
    )
api = api.replace(
    '$bodyParts = array_values(array_filter([$company, $timeCode, $completedBy], function($v) {',
    '$bodyParts = array_values(array_filter([$company, $pickupTime, $completedBy], function($v) {'
)
api = re.sub(
    r"'title'\s*=>\s*\$company\s*\.\s*' 集荷済み',",
    "'title' => $course . '/' . $company . '/ 集荷済み',",
    api,
    count=1,
)
if "$pickupTime" not in api or "$course . '/' . $company" not in api:
    raise SystemExit('api patch verification failed')
API_PATH.write_text(api, encoding='utf-8', newline='\n')

for path in [WORKFLOW_PATH, SCRIPT_PATH]:
    if path.exists():
        path.unlink()

print('patched pickup completion notice')
