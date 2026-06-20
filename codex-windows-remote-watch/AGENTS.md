# AGENTS.md

このフォルダは、OpenAI CodexのWindowsリモート操作対応状況を監視するための設定一式です。

## 方針

- 公式情報だけを根拠にする。
- Gmailアドレス、APIキー、トークン、認証情報はコミットしない。
- 監視対象はOpenAI DevelopersのCodex Remote connectionsページを中心にする。
- 通知ノイズを減らすため、ページ全体ではなくWindows Remote Control制限に関係する本文断片を比較する。
- 仕様確認時は必ず公式ページを開いて、Windowsから別PCを制御できるようになったかを直接確認する。

## 重要な確認文言

- `Windows can't currently control another computer from the Codex App`
- `You can control a Windows host from ChatGPT on iOS or Android`
- `or from a Mac running Codex`
- `Codex mobile setup supports Codex App hosts on macOS and Windows`

## 2台PC運用

- GitHubを母艦にする。
- 作業開始時はGitHubの最新状態を確認する。
- 作業終了時はREADMEまたはCODEX_HANDOFF.mdに状態を残す。
- ローカル一時ファイル、YouTube取得HTML、空字幕ファイルはコミットしない。
