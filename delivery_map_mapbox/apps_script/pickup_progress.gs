const SPREADSHEET_ID = '1KLblt-Ccx1xBppSzx9BnYcJuEHYkAlJ2KDEXeTa0swU';
const PICKUP_PROGRESS_SECRET = 'change-this-secret';
const ALLOWED_SHEETS = ['小舟町店', '浜町店 南', '浜町店 北'];
const PROGRESS_COLUMNS = ['collected', 'collected_at', 'collected_by'];

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.secret !== PICKUP_PROGRESS_SECRET) {
      return jsonResponse({ ok: false, error: 'unauthorized' });
    }

    const sheetName = String(payload.sheet || '').trim();
    if (!ALLOWED_SHEETS.includes(sheetName)) {
      return jsonResponse({ ok: false, error: 'unsupported sheet' });
    }

    const row = Number(payload.row || 0);
    if (!Number.isInteger(row) || row < 2) {
      return jsonResponse({ ok: false, error: 'invalid row' });
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return jsonResponse({ ok: false, error: 'sheet not found' });
    if (row > sheet.getMaxRows()) return jsonResponse({ ok: false, error: 'row out of range' });

    const headers = ensureProgressColumns(sheet);
    const idCol = headers.id;
    if (payload.id && idCol) {
      const currentId = String(sheet.getRange(row, idCol).getDisplayValue()).trim();
      if (currentId !== String(payload.id).trim()) {
        return jsonResponse({ ok: false, error: 'id mismatch' });
      }
    }

    const collected = !!payload.collected;
    sheet.getRange(row, headers.collected).setValue(collected);
    sheet.getRange(row, headers.collected_at).setValue(collected ? String(payload.collected_at || '') : '');
    sheet.getRange(row, headers.collected_by).setValue(collected ? String(payload.collected_by || '') : '');

    return jsonResponse({
      ok: true,
      sheet: sheetName,
      row,
      collected,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function ensureProgressColumns(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headerValues = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const headers = {};
  headerValues.forEach((value, index) => {
    const key = String(value || '').trim();
    if (key) headers[key] = index + 1;
  });

  PROGRESS_COLUMNS.forEach(name => {
    if (!headers[name]) {
      const col = sheet.getLastColumn() + 1;
      sheet.getRange(1, col).setValue(name);
      headers[name] = col;
    }
  });

  return headers;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
