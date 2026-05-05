/**
 * シフト通知スクリプト
 * 毎日19:00に翌日の出勤者をLINEグループに@All付きで通知する
 *
 * 【初回セットアップ手順】
 * 1. LINE Developersでチャンネル作成 → LINE_CHANNEL_TOKENを取得
 * 2. BotをLINEグループに追加 → LINE_GROUP_IDを取得（下記getGroupId参照）
 * 3. このスクリプトをGoogle Apps Scriptに貼り付け
 * 4. CONFIGの空欄を埋める
 * 5. GASトリガーを「時間ベース → 毎日 19:00〜20:00」に設定
 */

// ==================== 設定（ここを編集） ====================
var CONFIG = {
  SPREADSHEET_ID:    '11qNYAo_7p0_-aIf1SGji4axzAoqsW3OxAIGTUoFHJY4',
  SHEET_NAME:        '大田区 シフト',
  DATE_HEADER_ROW:   2,   // 日付ヘッダー行番号（Date型で格納されている行）
  STAFF_NAME_COL:    4,   // スタッフ名の列番号（D列 = 4）
  DATA_START_ROW:    4,   // スタッフデータ開始行番号（行3は時間帯ラベル）
  LINE_CHANNEL_TOKEN: '', // ← LINE Channel Access Token を貼り付け
  LINE_GROUP_ID:      '', // ← LINE グループID を貼り付け
};

// ==================== メイン関数 ====================
function sendShiftNotification() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('シートが見つかりません: ' + CONFIG.SHEET_NAME);
  }

  // 明日の日付（JST基準）
  var tz = Session.getScriptTimeZone();
  var tomorrow = new Date(new Date().getTime() + 24 * 60 * 60 * 1000);
  var month = Number(Utilities.formatDate(tomorrow, tz, 'M'));
  var day   = Number(Utilities.formatDate(tomorrow, tz, 'd'));
  var dowIdx = Number(Utilities.formatDate(tomorrow, tz, 'u')); // 1=月 〜 7=日
  var dow   = ['月','火','水','木','金','土','日'][dowIdx - 1];
  var dateLabel = month + '/' + day + '(' + dow + ')';

  // ヘッダー行から翌日の列を検索
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(CONFIG.DATE_HEADER_ROW, 1, 1, lastCol).getValues()[0];

  var morningCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (dateMatches(headers[i], tomorrow)) {
      morningCol = i + 1;
      break;
    }
  }

  if (morningCol === -1) {
    Logger.log('翌日のシフトが見つかりません: ' + dateLabel);
    return;
  }
  var eveningCol = morningCol + 1;

  // スタッフ名・出勤データ取得
  var lastRow = sheet.getLastRow();
  var numRows = lastRow - CONFIG.DATA_START_ROW + 1;
  var names   = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.STAFF_NAME_COL, numRows, 1).getValues();
  var morning = sheet.getRange(CONFIG.DATA_START_ROW, morningCol,            numRows, 1).getValues();
  var evening = sheet.getRange(CONFIG.DATA_START_ROW, eveningCol,            numRows, 1).getValues();

  var amStaff      = [];
  var pmStaff      = [];
  var allDayStaff  = [];

  for (var r = 0; r < names.length; r++) {
    var name = String(names[r][0]).trim();
    if (!name) continue;
    if (!isStaffName(name)) continue; // エリア名・集計行を除外

    var am = String(morning[r][0]).trim();
    var pm = String(evening[r][0]).trim();
    if (am === '休み') am = '';
    if (pm === '休み') pm = '';

    if (am && pm) {
      allDayStaff.push(name);
    } else if (am) {
      amStaff.push(name);
    } else if (pm) {
      pmStaff.push(name);
    }
  }

  if (!allDayStaff.length && !amStaff.length && !pmStaff.length) {
    Logger.log(dateLabel + ' は出勤者なし。送信スキップ。');
    return;
  }

  // メッセージ組み立て
  var body = dateLabel + ' メンバー\n';

  if (allDayStaff.length) {
    body += '\n【終日 9:30〜20:30】\n' + allDayStaff.map(function(n){ return n + 'さん'; }).join('\n') + '\n';
  }
  if (amStaff.length) {
    body += '\n【AM 9:30〜14:00】\n' + amStaff.map(function(n){ return n + 'さん'; }).join('\n') + '\n';
  }
  if (pmStaff.length) {
    body += '\n【PM 16:00〜20:30】\n' + pmStaff.map(function(n){ return n + 'さん'; }).join('\n') + '\n';
  }

  body += '\n各自確認次第 👍 でリアクションお願いします。';

  sendLineMessage('@All\n' + body);
  Logger.log('送信完了:\n' + '@All\n' + body);
}

// ==================== スタッフ名フィルタ ====================
function isStaffName(name) {
  if (!name) return false;
  if (/W$/.test(name)) return false;          // 大森西W など（エリアコード）
  if (name.indexOf('枠数') !== -1) return false; // 必要枠数・枠数実績
  if (/^[①-⑩]/.test(name)) return false;     // ①②始まりの番号
  if (/川崎[①②③]$/.test(name)) return false; // 他社ドライバー川崎①②
  return true;
}

// ==================== 日付マッチ ====================
function dateMatches(cellValue, targetDate) {
  var tz = Session.getScriptTimeZone();
  var targetStr = Utilities.formatDate(targetDate, tz, 'M/d');
  // GASのDate型はinstanceof Dateがfalseになるため getTime() で判定
  try {
    if (cellValue && typeof cellValue.getTime === 'function') {
      return Utilities.formatDate(new Date(cellValue.getTime()), tz, 'M/d') === targetStr;
    }
  } catch(e) {}
  return String(cellValue).indexOf(targetStr) !== -1;
}

// ==================== LINE送信 ====================
function sendLineMessage(text) {
  var payload = {
    to: CONFIG.LINE_GROUP_ID,
    messages: [{
      type: 'textV2',
      text: text,
      mentionees: [{
        index: 0,  // テキスト先頭の "@All"
        length: 4, // "@All" は4文字
        type: 'all'
      }]
    }]
  };

  var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('LINE APIエラー: ' + code + ' / ' + response.getContentText());
  }
}

// ==================== グループID取得用（初回1回だけ実行） ====================
/**
 * 手順:
 * 1. https://webhook.site にアクセスし、表示された一意のURLをコピー
 * 2. LINE Developersコンソール → Messaging API → Webhook URL に貼り付け
 * 3. 「Webhookの利用」をONにする
 * 4. BotをLINEグループに追加する
 * 5. グループ内で誰かがメッセージを送る
 * 6. webhook.site の画面にJSONが届く → "groupId" の値をコピー
 * 7. CONFIG.LINE_GROUP_ID に貼り付ける
 */
function getGroupId() {
  Logger.log('上記コメントの手順でグループIDを取得してください。');
}

// ==================== 動作テスト用 ====================
function testSendToday() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) { Logger.log('❌ シートが見つかりません'); return; }

  var tz = Session.getScriptTimeZone();
  var today = new Date();
  var targetStr = Utilities.formatDate(today, tz, 'M/d');

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(CONFIG.DATE_HEADER_ROW, 1, 1, lastCol).getValues()[0];

  var targetCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (dateMatches(headers[i], today)) { targetCol = i + 1; break; }
  }

  if (targetCol === -1) {
    Logger.log('⚠️ ' + targetStr + ' の列が見つかりません');
    return;
  }

  var numRows = sheet.getLastRow() - CONFIG.DATA_START_ROW + 1;
  var names   = sheet.getRange(CONFIG.DATA_START_ROW, CONFIG.STAFF_NAME_COL, numRows, 1).getValues();
  var morning = sheet.getRange(CONFIG.DATA_START_ROW, targetCol,     numRows, 1).getValues();
  var evening = sheet.getRange(CONFIG.DATA_START_ROW, targetCol + 1, numRows, 1).getValues();

  Logger.log('✅ ' + targetStr + ' の出勤者:');
  for (var r = 0; r < names.length; r++) {
    var name = String(names[r][0]).trim();
    if (!name || !isStaffName(name)) continue;
    var am = String(morning[r][0]).trim();
    var pm = String(evening[r][0]).trim();
    if (am === '休み') am = '';
    if (pm === '休み') pm = '';
    if (am || pm) {
      Logger.log('  ' + name + ' | AM: ' + (am || '－') + ' | PM: ' + (pm || '－'));
    }
  }
}
