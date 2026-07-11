# 3本指スクショ (Three Finger Screenshot for Pixel)

OPPO / ColorOS の「3本指で下にスワイプしてスクリーンショット」「長い（スクロール）スクリーンショット」を、
**Google Pixel（および Android 11 以降の素の Android 端末）** で再現するアプリです。

## 機能

| 操作 | 動作 |
|---|---|
| **3本指で下にスワイプ** | 通常のスクリーンショット |
| **3本指で上にスワイプ** | ロング（スクロール）スクリーンショット。自動でページをスクロールしながら撮影し、1枚の縦長画像につなぎ合わせます |
| **クイック設定タイル** | 通知シェードを閉じてからワンタップで撮影 |

- 保存先: `Pictures/Screenshots`（Google フォトの「スクリーンショット」に表示されます）
- **INTERNET 権限なし** — 画像が外部に送信されることは一切ありません

## 仕組み

- 3本指ジェスチャーの検出には、Android 13 で追加されたユーザー補助（アクセシビリティ）サービスの
  **`TouchInteractionController`** を使用しています。タッチイベントはまず本アプリに届き、
  タッチ開始から最大120msだけ様子を見て:
  - 3本指が揃えば本アプリがスワイプ判定を行い（画面側は反応しません）、
  - それ以外は `requestDelegating()` で即座に通常の入力パイプラインへ委譲します。
    委譲時にフレームワークが現在の指位置で DOWN を注入するため、
    **1本指・2本指の通常操作はほぼ遅延なくそのまま動きます**
    （委譲前に終わる素早いタップは `performClick()` で再現）。
- フレームワーク標準のマルチフィンガージェスチャー検出
  （`FLAG_REQUEST_MULTI_FINGER_GESTURES`）は、1本指操作を守るための全画面
  パススルー領域と両立できない（パススルー領域内で始まったタッチは
  ジェスチャー検出ごとスキップされる）ため使用していません。
- スクリーンショット本体は `AccessibilityService.takeScreenshot()`（Android 11+）で撮影します。
  root や MediaProjection（画面録画の常駐通知）は不要です。
- ロングスクショは「撮影 → ゆっくりドラッグを注入してスクロール → 再撮影 →
  前後フレームの行輝度シグネチャを照合して実スクロール量を推定 → 新規部分だけ連結」
  を繰り返して合成します（最大10ページ / 高さ16,000pxまで）。

## ビルド方法

Android Studio (Hedgehog 以降) でこのフォルダ (`pixel-three-finger-screenshot`) を開いてビルドするか、
Android SDK があればコマンドラインで:

```bash
cd pixel-three-finger-screenshot
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

- compileSdk 34 / minSdk 30 (Android 11) / Kotlin 1.9 / 依存は kotlinx-coroutines のみ

## セットアップ手順（初回のみ）

1. APK をインストールしてアプリを開く
2. 「ユーザー補助の設定を開く」→ **3本指スクショ** → ON（フルコントロールを許可）
3. 通知の表示を許可（撮影完了通知のプレビュー用）
4. アプリ内の「テスト」ボタン、または任意の画面で3本指スワイプを試す
5. （任意）クイック設定パネルを編集して「スクリーンショット」タイルを追加

## 制限・注意事項

- **3本指ジェスチャーには Android 13 以降が必要**です（`TouchInteractionController` API のため）。
  Android 11〜12 ではクイック設定タイルとアプリ内テストボタンのみ使えます。
- **TalkBack などジェスチャーを使う他のユーザー補助サービスとは併用できません。**
- 銀行アプリ・動画配信など `FLAG_SECURE` が設定された画面は撮影できません（Android の仕様）。
- ロングスクショの合成は画像照合ベースのため、以下の画面では継ぎ目が乱れることがあります:
  - スクロールに追従する固定ヘッダー／パララックスがある画面
  - 動画やアニメーションが再生中の画面
  - 同じ模様が延々と続く画面
- ごく一部の端末・状況で3本指ジェスチャーの検出がゲームなどの多点タッチ操作と競合する場合は、
  クイック設定タイルをご利用ください。
- Pixel 標準でも Android 12 以降はスクリーンショット後に「キャプチャ範囲を拡大」で
  ロングスクショが撮れます。本アプリはそれを「3本指ジェスチャー一発」にするものです。

## プロジェクト構成

```
app/src/main/java/com/okunukino/threefingershot/
├── ScreenshotAccessibilityService.kt  # サービス本体: 撮影・保存・通知
├── ThreeFingerGestureDetector.kt      # TouchInteractionControllerによる3本指検出
├── LongScreenshotCapturer.kt          # 自動スクロール＋画像スティッチング
├── ScreenshotSaver.kt                 # MediaStore への保存
├── ScreenshotTileService.kt           # クイック設定タイル
└── MainActivity.kt                    # 設定・テスト用画面
```
