# Codex Windows Remote Watch

OpenAI CodexのRemote connections公式ページを毎日確認し、Windows同士のCodex Appリモート操作対応に関係する変化があった時だけGmailへ通知するための設定です。

## 目的

- Windows PCから別のWindows PCをCodex Appで操作できるようになったかを早く知る
- 公式情報だけを監視する
- PCがスリープ中でも動くようにGoogle Apps Scriptで実行する
- 2台PC運用ではGitHubを母艦として、この設定をどちらのPCからでも参照できるようにする

## 監視対象

- https://developers.openai.com/codex/remote-connections

## 通知条件

ページ全体ではなく、Windows Remote Control制限に関係する本文断片だけを比較します。
これにより、OpenAI Developersサイトのナビゲーションや検索候補の変更によるノイズ通知を減らします。

## セットアップ

1. https://script.google.com/ を開く
2. 新しいプロジェクトを作成
3. `codex_windows_remote_watch.gs` の内容をApps Scriptの `コード.gs` に貼り付け
4. `initializeCodexWindowsRemoteWatch` を1回実行
5. `createDailyCodexWindowsRemoteTrigger` を1回実行
6. トリガー画面で `checkCodexWindowsRemoteUpdates` の時間主導型トリガーがあることを確認

## テスト

`sendTestCodexWindowsRemoteWatchEmail` を実行すると、現在のGoogleアカウント宛てにテストメールを送ります。

## 運用

- 変更がない日はメールを送りません
- 通知が来たら、公式ページを確認して実質的な変更か判断します
- 重要な変更があれば、このREADMEや `CODEX_HANDOFF.md` を更新します

## 個人情報

このリポジトリにはGmailアドレスや認証情報を入れません。宛先はApps Script実行中のGoogleアカウントから取得します。
