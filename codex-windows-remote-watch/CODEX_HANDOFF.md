# CODEX_HANDOFF

## 現在の目的

2台のWindows PC間で作業を続けやすくするため、GitHubを母艦にしてCodex関連の設定・手順・引き継ぎを保存する。

## 現在GitHubに移したもの

- `README.md`: 監視設定の目的、セットアップ、運用方法
- `codex_windows_remote_watch.gs`: Google Apps Script用の監視スクリプト
- `AGENTS.md`: Codexに守ってほしい作業ルール
- `CODEX_HANDOFF.md`: この引き継ぎメモ

## Apps Script側の現在運用

ユーザーはGoogle Apps Scriptで次の作業を完了済み。

- `initializeCodexWindowsRemoteWatch` 実行
- `createDailyCodexWindowsRemoteTrigger` 実行
- `checkCodexWindowsRemoteUpdates` の時間主導型トリガーを作成

初回通知で `https://developers.openai.com/codex/remote-connections` の変更が検知されたが、確認した結果、Windows同士のCodex App Remote Control対応開始ではなく、ページ全体ハッシュ比較によるノイズ検知と判断した。

## 次にやること

1. Google Apps Script内の古いコードを、GitHub上の `codex_windows_remote_watch.gs` の改善版に差し替える。
2. `initializeCodexWindowsRemoteWatch` を再実行して、新しい監視スナップショットを保存する。
3. `createDailyCodexWindowsRemoteTrigger` を再実行して、重複トリガーを整理する。
4. 必要なら `sendTestCodexWindowsRemoteWatchEmail` でテスト通知を送る。

## 現時点の公式確認結果

2026-06-20時点では、OpenAI公式のRemote connectionsページに以下の制限が残っている。

- WindowsホストはChatGPT iOS/AndroidまたはMacのCodex Appから操作可能。
- WindowsのCodex Appから別のコンピューターを操作することは現在不可。

公式ページ:
https://developers.openai.com/codex/remote-connections

## 注意

- このリポジトリは公開リポジトリなので、Gmailアドレスや秘密情報を入れない。
- ローカルのYouTube確認用HTMLや字幕ファイルは一時ファイルなのでGitHubに移さない。
- 「同じチャットを共有」ではなく「GitHub上の状態と引き継ぎメモを共有」する運用にする。
