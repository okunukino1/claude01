const WATCH_CONFIG = {
  subjectPrefix: "[Codex Windows remote watch]",
  remoteConnectionsUrl: "https://developers.openai.com/codex/remote-connections",
  // 空欄のままで現在のGoogleアカウント宛てに送ります。
  // 宛先取得でエラーになる場合だけ、ここにGmailアドレスを直接入れてください。
  recipientEmail: "",
  decisivePhrases: [
    "Windows can't currently control another computer from the Codex App",
    "You can control a host from ChatGPT on iOS or Android, or from another Mac or Windows device when Control other devices is available",
    "On a Mac or Windows device where the feature is available, use Settings > Connections > Control other devices to add the other host",
    "Access and control other devices from this computer",
    "Control this Mac or PC",
    "Control other devices"
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
  const targetStatus = detectTargetAvailability(text);
  const hash = digest(snapshot);
  const previousHash = props.getProperty("remoteConnectionsSnapshotHash");
  const previousSnapshot = props.getProperty("remoteConnectionsSnapshot") || "";
  const previousTargetStatus = props.getProperty("remoteConnectionsTargetStatus") || "";

  props.setProperty("remoteConnectionsSnapshotHash", hash);
  props.setProperty("remoteConnectionsSnapshot", snapshot);
  props.setProperty("remoteConnectionsTargetStatus", targetStatus);

  if (!previousHash || previousTargetStatus === targetStatus) {
    return;
  }

  if (!shouldNotifyForTargetStatusChange(previousTargetStatus, targetStatus)) {
    return;
  }

  const lines = [
    "Codex / ChatGPT Remote のPC同士の操作可否に関係する変更を検出しました。",
    "",
    "判定:",
    "- 前回: " + statusLabel(previousTargetStatus),
    "- 今回: " + statusLabel(targetStatus),
    "",
    "確認ポイント:",
    "- Windows PCから別のPCを操作できる状態になったか",
    "- Control other devices がWindows側で使える状態になったか",
    "- ただし、公式ページ上の availability can vary by rollout はアカウントごとの提供差を意味します",
    "",
    "URL:",
    WATCH_CONFIG.remoteConnectionsUrl,
    "",
    "HTTP status: " + status,
    "",
    "現在の監視スナップショット:",
    snapshot,
    "",
    "公式ページと自分のChatGPTデスクトップアプリの Settings > Connections を確認してください。"
  ];

  MailApp.sendEmail({
    to: getRecipientEmail(),
    subject: WATCH_CONFIG.subjectPrefix + " PC同士の遠隔操作に関係する変更あり",
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

function shouldNotifyForTargetStatusChange(previousStatus, currentStatus) {
  if (currentStatus === "desktop_control_available_rollout") {
    return previousStatus !== "desktop_control_available_rollout";
  }
  if (previousStatus === "desktop_control_available_rollout" && currentStatus !== "desktop_control_available_rollout") {
    return true;
  }
  return false;
}

function detectTargetAvailability(text) {
  const lower = text.toLowerCase();
  const oldWindowsBlocked = lower.includes("windows can't currently control another computer from the codex app".toLowerCase());
  const desktopControlAvailable =
    lower.includes("from another mac or windows device when control other devices is available") ||
    lower.includes("on a mac or windows device where the feature is available") ||
    (lower.includes("control other devices") && lower.includes("access and control other devices from this computer") && lower.includes("windows device"));

  if (desktopControlAvailable) {
    return "desktop_control_available_rollout";
  }
  if (oldWindowsBlocked) {
    return "windows_control_blocked";
  }
  return "unknown_or_unrelated";
}

function statusLabel(status) {
  if (status === "desktop_control_available_rollout") return "PC同士の遠隔操作に関係する文言あり（提供状況はロールアウト依存）";
  if (status === "windows_control_blocked") return "Windowsから別PCを操作できない文言あり";
  if (status === "unknown_or_unrelated") return "判定対象外または不明";
  return status || "初回実行";
}

function buildRelevantSnapshot(text) {
  const snippets = WATCH_CONFIG.decisivePhrases.map((phrase) => {
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
