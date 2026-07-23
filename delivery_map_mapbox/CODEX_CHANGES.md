# Claude / Codex 現状報告 — プロジェクト全体の状態 (2026-07-23)

## 0. Codex追記（2026-07-23）

- 作業基準は最新 `origin/main` のコミット `1e11233fec51fc1c8a1b4628ebf965ad12c6302d`。
- 安定版は引き続き **v2026.07.10-1**。新機能は反映していない。
- テスト版は **v2026.06.24-test.81** へ更新準備中。
- `配送先を編集` と手入力の荷物情報を自由入力からマスター選択式へ変更。
- 荷物情報マスターは `id / label / enabled / sort_order` の4列。テスト専用API `api/package_types_test.php` が既存Googleスプレッドシートの `荷物情報マスター` タブを優先し、タブが未作成・取得不能の場合は `test/data/package_types_master.csv` を読む。
- 既存の自由入力データは削除せず、編集時だけ `（登録済み）` の選択肢として保持する。
- `指定時刻（任意）` を `時間指定` のまとまりへ移動し、画面下の `事前入力` 欄を削除。
- Googleスプレッドシートの実タブ追加は、Codexのブラウザ連携が接続できなかったため未実施。Excel版 `荷物情報マスター.xlsx` は作成済み。
- **通常版DB API `api/delivery_geocode_cache.php` には、テスト版にある `manual=1` の保護処理がまだ未反映。通常版昇格時に必ず別途確認すること。**

---

**宛先: Codex**
このドキュメントは、Claude（別AIセッション）が `delivery_map_mapbox/` と `capacitor/` に行った作業の最新報告です。前回の報告（2026-06-12, v2026.06.12-test.1）から大きく進んでいるため、**過去の報告は破棄してこのファイルを唯一の最新状態として扱ってください。**

**同じ内容を二重に実装しないでください。** また、下記の「開発ルール」を必ず守ってください。

---

## 1. バージョンの現状（2026-07-10 時点）

| 対象 | バージョン | 状態 |
|---|---|---|
| 安定版 `index.html` | **v2026.07.10-1** | 本日、テスト版 test.54 を全面昇格。デプロイ済み（Actions run #259 success） |
| テスト版 `test/index.html` | **v2026.06.24-test.54** | 安定版と機能同等。今後の新機能開発はここで行う |
| Androidアプリ (APK) | test.54 相当 | `capacitor/` のCapacitorシェル。**テスト版URLを読み込む。安定版用APKは作らない（ユーザー指示）** |

- 安定版と テスト版は現在**機能的に同一**（差分は名前空間・URL・ブランディングのみ）。
- 前回の昇格は 2026-07-07（test.46 → v2026.07.07-1, コミット `e581432`）。今回は test.47〜54 の差分を追加昇格（コミット `cc644f2`）。

---

## 2. 前回報告(6/12)以降に実装された主要システム

すべて**テスト版で実装 → 検証 → 安定版へ昇格済み**。両方に入っています。

### 地図表示
- **全国番地表示エンジン**: Geolonia japanese-addresses-v2 API（ja.jsonカタログ → 市区町村ごとの machiaza CSV を HTTP Range で取得）。ズームに応じて番地ラベルを描画。IndexedDB（`rys-mapbox(-test)-banchi` DB）に30日キャッシュ、GPS位置から先読み。診断パネルあり（メニュー→番地診断）。
- **筆界（地番境界）ライン**: 法務省登記所備付地図データ（amx-project）の PMTiles を `api/amx_tile_proxy.php` 経由で読む。レイヤは daihyo(z2-13)/fude(z14-16)。3D建物に隠れないよう slot:'top'。
- **起動高速化**: Service Worker（stale-while-revalidate でアプリ本体を即表示）、設定キャッシュ、前回表示位置の復元、preconnect。地図が上半分しか描画されない起動バグも修正済み。

### 伝票OCR（Gemini 2.5-flash-lite, `api/extract_address.php`）
- プレビュー表示中にOCRを先行実行、バイナリPOST送信（base64レガシーも受付）
- **回転自動リカバリ**: APIが `rotation_hint` を返し、失敗時は hint→180→90→270 の順で最大4回リトライ
- **発送元の除外**: 住所が2つ写った場合、GPS現在地に近い方（=お届け先）を採用。発送元にはピンを立てない
- **郵便番号アンカー**: 「東日本橋」を「日本橋」に誤読するような欠落を郵便番号で補正
- **要確認ピン検証** (`validateDeliveryPlacement`): ジオコード結果が住所と食い違う場合は「要確認」ピンにして警告
- 自信度（confidence）低下時の警告表示

### 荷物運用
- **複数個口**: 同じ住所を再スキャンすると重複ブロックせず、1本のピンに個数を積み上げ表示
- **連続撮影モード**: マップに戻らず連続スキャン。手入力も連続入力モードあり
- **まとめて読み込み**: 標準カメラアプリで撮った写真をギャラリーから一括インポート（並列4で処理）
- **手入力の番地・号は常に空欄で開始**（前回値の復元は禁止 — ユーザー明示要求。3箇所で漏れを潰した経緯あり）
- **手動ピン修正の記憶**: ピンを手で直すと共有ジオコードキャッシュ（MySQL, `api/delivery_geocode_cache(.php/_test.php)`）に `manual=1` で保存。**自動保存は `manual=1` の行を絶対に上書きしない**（`IF(manual=1,...)` で保護）
- **時間指定の自動読み取りは削除済み**（誤作動多発のため）。手動設定機能は残存

### マニュアル
- `manual.html`（安定版・テスト版それぞれ）を全面書き直し済み（コミット `30fe7d5`）。**機能を変えたらマニュアルも更新するのが恒久ルール。**

---

## 3. Androidアプリ（Capacitorシェル）— 新規追加

`capacitor/` ディレクトリと `.github/workflows/android-apk.yml` を新設。

- **目的**: 連写（ネイティブカメラでの高速連続撮影＋バックグラウンドでのピン処理）はブラウザでは実現できないため、Android のみアプリ化
- **構成**: Capacitor 8。`server.url = https://rys-services.com/delivery_map_mapbox/test/` — アプリの中身はライブのテスト版を読むだけなので、**Web側の変更はAPK再ビルド不要で即反映**
- **ネイティブカメラ**: `@capacitor-community/camera-preview`（toBack:true, WebView透過必須 → `MainActivity.java` で `setBackgroundColor(TRANSPARENT)` 済み）。連写モードと通常1枚撮影の両方がネイティブカメラを使用。Android 11+ の `<queries>`(IMAGE_CAPTURE) もマニフェストに追加済み
- **CI**: main への `capacitor/**` push で APK をビルドし、FTPで `app/rys-map.apk` として配布（https://rys-services.com/delivery_map_mapbox/app/rys-map.apk）。Node 22 / Java 21 必須
- **安定版・index.html 側にもネイティブカメラのコードは入っているが**、`window.Capacitor` の存在チェックでガードされており、**ブラウザ/PWAでは完全に無効（従来どおり file input → OSカメラ）**
- **安定版URL用のAPKは作らない**（ユーザー指示: まだ不要）。iPhone版も当面作らない（配布コストの問題）

### ⚠️ 過去の失敗（繰り返さないこと）
- **ブラウザの getUserMedia でのアプリ内カメラは実装済み→撤回済み**（`d813537` → revert `47176a2`）。ピント・画質が実用に耐えずOCR精度が落ちた。「OCR精度を落とさない」が絶対条件。Webでのカメラ内製化は提案しないこと。

---

## 4. 開発ルール（必読・変更禁止）

1. **新機能はすべて `test/` に実装。** 安定版 `index.html` はユーザーが明示的に「昇格して」と言った時だけ更新する
2. **昇格は機械的変換**で行う（今回 `cc644f2` の手順）:
   - `../api/` → `api/`（テスト版は1階層深い）
   - `delivery_geocode_cache_test.php` → `delivery_geocode_cache.php`
   - `rys-mapbox-test-*` → `rys-mapbox-*`（localStorage/IndexedDBキー 36個）
   - `テスト版` ブランディング除去（title / h1バッジ / 通知文言）
   - Service Worker: キャッシュ名 `rys-test-*`→`rys-*`、パス `/test/` 除去、通知タイトル
   - `APP_VERSION` とキャッシュバスター（`?v=`）を新しい日付版に
   - 変換後に残存マーカーがゼロであることを検証してからコミット
3. **`APP_VERSION` は変更のたびに必ず上げる**（テスト版は `v2026.06.24-test.NN` の NN をインクリメント）
4. **コミット前に構文チェック**: インライン `<script>` を抽出して `node --check`
5. **デプロイ**: main への `delivery_map_mapbox/**` push で GitHub Actions が FTP デプロイ（約1分）。`capacitor/**` push で APK ビルド
6. マニュアル（`manual.html` 両版）を機能変更に追随させる
7. 共有ジオコードキャッシュの `manual=1` 行を自動処理で上書きしない

---

## 5. 主要ファイル

| ファイル | 役割 |
|---|---|
| `delivery_map_mapbox/index.html` | 安定版本体（v2026.07.10-1, 約8900行） |
| `delivery_map_mapbox/test/index.html` | テスト版本体（test.54）— 開発はここ |
| `delivery_map_mapbox/service-worker.js` / `test/service-worker.js` | SWキャッシュ（shell: SWR / static: cache-first / APIは非キャッシュ） |
| `delivery_map_mapbox/manual.html` / `test/manual.html` | 利用マニュアル（両版） |
| `api/extract_address.php` | Gemini OCR（バイナリPOST + base64、rotation_hint返却） |
| `api/delivery_geocode_cache.php` / `_test.php` | 共有ジオコードキャッシュ（MySQL, manualフラグ保護） |
| `api/amx_tile_proxy.php` | 法務省 PMTiles プロキシ（筆界ライン用） |
| `capacitor/` | Capacitor Androidシェル（appId `com.rys.deliverymap`） |
| `.github/workflows/deploy-delivery-map.yml` | Web FTPデプロイ |
| `.github/workflows/android-apk.yml` | APKビルド＆FTP配布 |

## 6. 前回昇格(7/7)以降のコミット一覧

| コミット | 内容 |
|---|---|
| `6d6b772` | 手動ピン修正の住所別記憶（manual保護付き） |
| `09271e9` | 時間指定の自動検出を削除（手動のみに） |
| `c0c4f13` / `bb1a67e` | 写真まとめて読み込み（並列4） |
| `30fe7d5` | マニュアル全面書き直し（両版） |
| `1dcad5a` / `02804ae` | Capacitor Androidシェル + APK CI（Node 22） |
| `e3bb374` / `76504b9` | ネイティブ連写カメラ + 白画面修正（WebView透過） |
| `ff506c2` | APKでの通常1枚撮影修正（`<queries>` + ネイティブ単写モード） |
| `cc644f2` | **test.54 → 安定版 v2026.07.10-1 へ昇格** |

---

*このファイルは Claude が 2026-07-10 に更新。質問があればユーザー経由で確認してください。*
