// ============================================================
//  既存の「集荷アプリ — Google Apps Script v3」へ追加するコード
//
//  1. 既存の doPost(e) の先頭付近に、下の分岐を追加してください。
//
//    const body = JSON.parse(e.postData.contents);
//    if (body.action === 'pickupProgress') {
//      return handlePickupProgress(body);
//    }
//
//  2. その下に、このファイルの関数を追加してください。
//  3. PICKUP_PROGRESS_SECRET を api/config.php と同じ値に変更してください。
// ============================================================

const PICKUP_PROGRESS_SECRET = 'change-this-secret';
const PICKUP_PROGRESS_ALLOWED_SHEETS = ['小舟町店', '浜町店 南', '浜町店 北'];
const PICKUP_PROGRESS_COLUMNS = ['collected', 'collected_at', 'collected_by'];

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
