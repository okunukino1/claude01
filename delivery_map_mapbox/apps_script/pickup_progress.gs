// ============================================================
//  既存の「集荷アプリ — Google Apps Script v3」へ追加するコード
//
//  1. 既存の doPost(e) の先頭付近に、下の分岐を追加してください。
//
//    const body = JSON.parse(e.postData.contents);
//    if (body.action === 'pickupProgress') {
//      return handlePickupProgress(body);
//    }
//    if (body.action === 'pickupLocation') {
//      return handlePickupLocation(body);
//    }
//    if (body.action === 'spotPickupsSync') {
//      return handleSpotPickupsSync(body);
//    }
//
//  2. その下に、このファイルの関数を追加してください。
//  3. PICKUP_PROGRESS_SECRET を api/config.php と同じ値に変更してください。
// ============================================================

const PICKUP_PROGRESS_SECRET = 'change-this-secret';
const PICKUP_PROGRESS_ALLOWED_SHEETS = ['小舟町店', '小舟町店スポット', '浜町店 南', '浜町店 南スポット', '浜町店 北', '浜町店 北スポット'];
const PICKUP_PROGRESS_COLUMNS = ['collected', 'collected_at', 'collected_by'];
const PICKUP_LOCATION_COLUMNS = ['lat', 'lng', 'approx', 'formatted'];
const SPOT_PICKUP_SHEET_NAME = '小舟町店スポット';
const SPOT_PICKUP_SHEET_NAMES = ['小舟町店スポット', '浜町店 南スポット', '浜町店 北スポット'];
const SPOT_PICKUP_COLUMNS = [
  'id',
  'company',
  'address',
  'time',
  'method',
  'notes',
  'phone',
  'date',
  'source',
  'collected',
  'collected_at',
  'collected_by',
];

function handlePickupProgress(payload) {
  if (payload.secret !== PICKUP_PROGRESS_SECRET) {
    return respond({ ok: false, error: 'unauthorized' });
  }

  const sheetName = String(payload.sheet || '').trim();
  if (!PICKUP_PROGRESS_ALLOWED_SHEETS.includes(sheetName)) {
    return respond({ ok: false, error: 'unsupported sheet' });
  }

  const row = Number(payload.row || 0);
  if (!Number.isInteger(row) || row < 2) {
    return respond({ ok: false, error: 'invalid row' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return respond({ ok: false, error: 'sheet not found' });
  if (row > sheet.getMaxRows()) return respond({ ok: false, error: 'row out of range' });

  const headers = ensurePickupProgressColumns(sheet);
  const idCol = headers.id;
  if (payload.id && idCol) {
    const currentId = String(sheet.getRange(row, idCol).getDisplayValue()).trim();
    if (currentId !== String(payload.id).trim()) {
      return respond({ ok: false, error: 'id mismatch' });
    }
  }

  const collected = !!payload.collected;
  sheet.getRange(row, headers.collected).setValue(collected);
  sheet.getRange(row, headers.collected_at).setValue(collected ? String(payload.collected_at || '') : '');
  sheet.getRange(row, headers.collected_by).setValue(collected ? String(payload.collected_by || '') : '');

  return respond({
    ok: true,
    sheet: sheetName,
    row,
    collected,
  });
}

function ensurePickupProgressColumns(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const headers = {};
  headerValues.forEach((value, index) => {
    const key = String(value || '').trim();
    if (key) headers[key] = index + 1;
  });

  PICKUP_PROGRESS_COLUMNS.forEach(name => {
    if (!headers[name]) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name);
      headers[name] = col;
    }
  });

  return headers;
}

function handlePickupLocation(payload) {
  if (payload.secret !== PICKUP_PROGRESS_SECRET) {
    return respond({ ok: false, error: 'unauthorized' });
  }

  const sheetName = String(payload.sheet || '').trim();
  if (!PICKUP_PROGRESS_ALLOWED_SHEETS.includes(sheetName)) {
    return respond({ ok: false, error: 'unsupported sheet' });
  }

  const row = Number(payload.row || 0);
  if (!Number.isInteger(row) || row < 2) {
    return respond({ ok: false, error: 'invalid row' });
  }

  const lat = Number(payload.lat);
  const lng = Number(payload.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return respond({ ok: false, error: 'invalid location' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return respond({ ok: false, error: 'sheet not found' });
  if (row > sheet.getMaxRows()) return respond({ ok: false, error: 'row out of range' });

  const headers = ensurePickupLocationColumns(sheet);
  const idCol = headers.id;
  if (payload.id && idCol) {
    const currentId = String(sheet.getRange(row, idCol).getDisplayValue()).trim();
    if (currentId !== String(payload.id).trim()) {
      return respond({ ok: false, error: 'id mismatch' });
    }
  }

  sheet.getRange(row, headers.lat).setValue(lat);
  sheet.getRange(row, headers.lng).setValue(lng);
  sheet.getRange(row, headers.approx).setValue(!!payload.approx);
  sheet.getRange(row, headers.formatted).setValue(String(payload.formatted || ''));

  return respond({
    ok: true,
    sheet: sheetName,
    row,
    lat,
    lng,
  });
}

function ensurePickupLocationColumns(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const headers = {};
  headerValues.forEach((value, index) => {
    const key = String(value || '').trim();
    if (key) headers[key] = index + 1;
  });

  PICKUP_LOCATION_COLUMNS.forEach(name => {
    if (!headers[name]) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name);
      headers[name] = col;
    }
  });

  return headers;
}

function handleSpotPickupsSync(payload) {
  if (payload.secret !== PICKUP_PROGRESS_SECRET) {
    return respond({ ok: false, error: 'unauthorized' });
  }

  const sheetName = String(payload.sheet || SPOT_PICKUP_SHEET_NAME).trim();
  if (!SPOT_PICKUP_SHEET_NAMES.includes(sheetName)) {
    return respond({ ok: false, error: 'unsupported spot sheet' });
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const date = String(payload.date || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  const headers = ensureSpotPickupColumns(sheet);
  const existing = readSpotPickupCompletionMap(sheet, headers, date);

  if (sheet.getMaxRows() < Math.max(items.length + 1, 2)) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(items.length + 1, 2) - sheet.getMaxRows());
  }
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, SPOT_PICKUP_COLUMNS.length).clearContent();
  }

  const rows = items
    .filter(item => item && item.id && item.address)
    .map(item => {
      const id = String(item.id || '').trim();
      const saved = existing[id] || {};
      const cancelled = item.cancelled === true || String(item.cancelled || '').toUpperCase() === 'TRUE';
      return SPOT_PICKUP_COLUMNS.map(name => {
        if (name === 'collected') return cancelled ? true : (saved.collected || false);
        if (name === 'collected_at') return cancelled ? String(item.collected_at || '') : (saved.collected_at || '');
        if (name === 'collected_by') return cancelled ? 'キャンセル' : (saved.collected_by || '');
        return String(item[name] || '');
      });
    });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, SPOT_PICKUP_COLUMNS.length).setValues(rows);
  }

  return respond({
    ok: true,
    sheet: sheetName,
    date,
    count: rows.length,
  });
}

function ensureSpotPickupColumns(sheet) {
  if (sheet.getMaxColumns() < SPOT_PICKUP_COLUMNS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), SPOT_PICKUP_COLUMNS.length - sheet.getMaxColumns());
  }
  const current = sheet.getRange(1, 1, 1, SPOT_PICKUP_COLUMNS.length).getDisplayValues()[0];
  let needsHeader = false;
  SPOT_PICKUP_COLUMNS.forEach((name, index) => {
    if (String(current[index] || '').trim() !== name) needsHeader = true;
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, SPOT_PICKUP_COLUMNS.length).setValues([SPOT_PICKUP_COLUMNS]);
    sheet.setFrozenRows(1);
  }

  const headers = {};
  SPOT_PICKUP_COLUMNS.forEach((name, index) => {
    headers[name] = index + 1;
  });
  return headers;
}

function readSpotPickupCompletionMap(sheet, headers, date) {
  const lastRow = sheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const values = sheet.getRange(2, 1, lastRow - 1, SPOT_PICKUP_COLUMNS.length).getDisplayValues();
  values.forEach(row => {
    const id = String(row[headers.id - 1] || '').trim();
    const rowDate = String(row[headers.date - 1] || '').trim();
    if (!id || (date && rowDate !== date)) return;
    map[id] = {
      collected: String(row[headers.collected - 1] || '').toUpperCase() === 'TRUE',
      collected_at: String(row[headers.collected_at - 1] || ''),
      collected_by: String(row[headers.collected_by - 1] || ''),
    };
  });
  return map;
}
