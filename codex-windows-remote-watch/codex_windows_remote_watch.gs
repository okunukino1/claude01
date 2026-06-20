const WATCH_CONFIG = {
  subjectPrefix: "[Codex Windows remote watch]",
  remoteConnectionsUrl: "https://developers.openai.com/codex/remote-connections",
  // 空欄のままで現在のGoogleアカウント宛てに送ります。
  // 宛先取得でエラーになる場合だけ、ここにGmailアドレスを直接入れてください。
  recipientEmail: "",
  watchedPhrases: [
    "Windows can't currently control another computer from the Codex App",
    "You can control a Windows host from ChatGPT on iOS or Android",
    "or from a Mac running Codex",
    "Codex mobile setup supports Codex App hosts on macOS and Windows"
  ]
};

function checkCodexWindowsRemoteUpdates() {
  const props = PropertiesService.getScriptProperties();
  const response = UrlFetchApp.fetch(WATCH_CONFIG.remoteConnectionsUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      "User-Agent": "Codex Windows remote watch"
    }
  });

  const status = response.getResponseCode();
  const html = response.getContentText();
  const text = normalizePage(html);
  const snapshot = buildRelevantSnapshot(text);
  const hash = digest(snapshot);
  const previousHash = props.getProperty("remoteConnectionsSnapshotHash");
  const previousSnapshot = props.getProperty("remoteConnectionsSnapshot") || "";

  props.setProperty("remoteConnectionsSnapshotHash", hash);
  props.setProperty("remoteConnectionsSnapshot", snapshot);

  if (!previousHash || previousHash === hash) {
    return;
  }

  const removedPhrases = WATCH_CONFIG.watchedPhrases.filter((phrase) => previousSnapshot.includes(phrase) && !snapshot.includes(phrase));
  const addedPhrases = WATCH_CONFIG.watchedPhrases.filter((phrase) => !previousSnapshot.includes(phrase) && snapshot.includes(phrase));

  const lines = [
    "OpenAI Codex Remote connections公式ページの重要監視部分に変更がありました。",
    "",
    "確認ポイント:",
    "- Windows PCから別のWindows PCをCodex Appで制御できるようになったか",
    "- Remote Control / mobile access / Windows host の制限が変わったか",
    "",
    "URL:",
    WATCH_CONFIG.remoteConnectionsUrl,
    "",
    "HTTP status: " + status,
    "",
    "追加された監視文言:",
    addedPhrases.length ? addedPhrases.map((phrase) => "- " + phrase).join("\n") : "- なし",
    "",
    "消えた監視文言:",
    removedPhrases.length ? removedPhrases.map((phrase) => "- " + phrase).join("\n") : "- なし",
    "",
    "現在の監視スナップショット:",
    snapshot,
    "",
    "公式ページを開いて、実質的な仕様変更か確認してください。"
  ];

  MailApp.sendEmail({
    to: getRecipientEmail(),
    subject: WATCH_CONFIG.subjectPrefix + " 重要監視部分に変更あり",
    body: lines.join("\n")
  });
}

function initializeCodexWindowsRemoteWatch() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  checkCodexWindowsRemoteUpdates();
}

function createDailyCodexWindowsRemoteTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "checkCodexWindowsRemoteUpdates")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("checkCodexWindowsRemoteUpdates")
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

function sendTestCodexWindowsRemoteWatchEmail() {
  MailApp.sendEmail({
    to: getRecipientEmail(),
    subject: WATCH_CONFIG.subjectPrefix + " テスト通知",
    body: "Codex Windowsリモート操作の監視メール設定テストです。\n\nこのメールが届けば、通知先Gmailの設定はできています。"
  });
}

function buildRelevantSnapshot(text) {
  const snippets = WATCH_CONFIG.watchedPhrases.map((phrase) => {
    const index = text.indexOf(phrase);
    if (index < 0) {
      return "MISSING: " + phrase;
    }
    const start = Math.max(0, index - 240);
    const end = Math.min(text.length, index + phrase.length + 240);
    return text.slice(start, end);
  });

  return snippets.join("\n---\n");
}

function normalizePage(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function digest(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytes
    .map((byte) => {
      const value = byte < 0 ? byte + 256 : byte;
      return ("0" + value.toString(16)).slice(-2);
    })
    .join("");
}

function getRecipientEmail() {
  const configured = (WATCH_CONFIG.recipientEmail || "").trim();
  if (configured) {
    return configured;
  }

  const activeUser = Session.getActiveUser().getEmail();
  if (activeUser) {
    return activeUser;
  }

  const effectiveUser = Session.getEffectiveUser().getEmail();
  if (effectiveUser) {
    return effectiveUser;
  }

  throw new Error("通知先Gmailアドレスを取得できませんでした。WATCH_CONFIG.recipientEmail に宛先を直接入れてください。");
}
