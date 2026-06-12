# Claude 実装報告 — テスト版改善 (2026-06-12)

**宛先: Codex**
このドキュメントは、Claude（別AIセッション）が `delivery_map_mapbox/test/index.html` に実装した変更の報告です。
**同じ内容を二重に実装しないでください。** 変更はすべてテスト版のみで、安定版 `index.html` と `api/` 配下のPHPには一切触れていません。

- 対象ファイル: `delivery_map_mapbox/test/index.html` のみ
- バージョン: `v2026.06.10-test.6` → **`v2026.06.12-test.1`**
- ベースコミット: `7d38787`（main マージ済み）

---

## 変更 1: 未使用コード削除 + ルート最適化の統合（コミット `bd4fcc4`）

### 削除
- `addLocalNeighborhoodLayers()`（旧 L.2176-2226、51行）— どこからも呼ばれていなかった
- `GSI_BOUNDARY_TILES` 定数とその説明コメント — 上記関数すら参照していなかった
- `data/chuo_nihonbashi_boundaries.geojson` 自体は削除していない（安定版が参照している可能性があるため）

### ルート最適化3関数の共通化
`optimizeRouteOrder` / `optimizeCarRouteOrder` / `optimizeGoogleCarRouteOrder` の重複部分（候補収集・tailNote・確認モーダル・並べ替え確定処理）を以下に抽出:

- `collectRouteCandidates()` — routeItems / noLocationItems / completedItems の振り分け
- `buildRouteTailNote(noLocationItems, completedItems)`
- `confirmAndApplyRouteOrder({ title, summary, suggested, ..., geometry, clearGeometry, successMessage })` — 確認→並べ替え→保存→再描画→flyTo→トースト
- `CAR_ROUTE_PROVIDERS` 設定オブジェクト（mapbox / google）+ `optimizeCarRouteOrderWith(providerKey)`
- `optimizeCarRouteOrder()` / `optimizeGoogleCarRouteOrder()` は薄いラッパーとして残存（メニューのハンドラ互換のため）

**挙動維持の注意点:**
- 「おすすめ順」は確定時に `clearOptimizedRouteGeometry()`（従来どおり）
- 車用2種は `data.geometry` がある時だけ `setOptimizedRouteGeometry()`、ない時は既存ジオメトリを消さない（従来どおり）
- ユーザー向け文言はすべて従来と同一になるよう `shortName` から組み立て（「車用」「Google車用」）

## 変更 2: マーカー差分更新（コミット `7134fd9`）

`updateDeliveryMarkerElement()` に内容シグネチャ方式の差分更新を導入:

```js
const contentSig = `${num}|${d.approx ? 1 : 0}|${labelText}|${overlapCount}`;
if (wrapper.dataset.contentSig === contentSig) return;  // innerHTML 再構築をスキップ
wrapper.dataset.contentSig = contentSig;
```

- **毎render実行のまま残したもの**: `classList.toggle('done'/'approx'/'spot')`、`style.zIndex`（完了状態・アクティブピンの前面化は従来どおり毎回反映）
- **スキップ対象**: `innerHTML=''` からのDOM再構築（番号・ラベル文字列・「N件」バッジが変わらない限り）
- `mapboxgl-marker` クラス保持の修正（あなたの `942bafc`）はそのまま生きています

## 変更 3: 国土地理院ジオコーダのフォールバック（コミット `e6b1f4d`）

`geocodeAddressUncached()` の末尾に追加。Google（`geocode_address.php`）が全候補文字列で見つからなかった場合のみ、ブラウザから直接 `https://msearch.gsi.go.jp/address-search/AddressSearch?q=...`（無料・キー不要）を呼びます。

- 新関数 `geocodeAddressViaGsi(query)` と定数 `GSI_GEOCODE_API`
- GSI結果は**常に `approx: true`**（精度保証がないため「?」バッジでピン位置確認を促す）+ `source: 'gsi'`
- ローカルキャッシュ（`setCachedGeocode`）には保存しない（approxは保存しない既存規約に従う）
- 共有DBキャッシュ（`saveSharedGeocodeCache`）には approx フラグ付きで保存（Googleのapprox結果と同じ扱い）
- **PHPは無変更**。安定版のジオコード動作に影響なし

## 変更 4: リスト検索ボックス + ピン薄表示（コミット `88aa4c1`）

### UI
- `.pickup-list-tabs` と `.list-body` の間に `#list-search`（検索入力 + クリアボタン）を追加
- リスト折りたたみ時は非表示（`body.list-collapsed .list-search { display: none }`）

### 検索仕様
- 対象フィールド: `address` / `formatted` / `note` / `completedBy` / `displayNumber()` + 集荷項目は `pickupListDisplay()` の company / detail
- 正規化: `NFKC`（全角半角統一）+ 小文字化 + 空白除去 → 部分一致
- **番号は変わらない**: モード/タブのフィルタ後の `{delivery, index}` に対して検索フィルタをかけるため、表示番号・クリック対象のIDは従来どおり
- 非ヒットのピンは `search-dim` クラスで opacity 0.25（削除はしない）
- モード切替時に `clearListSearch()` で自動クリア
- 入力は150msデバウンス、Enterでキーボードを閉じる
- 検索中の統計表示は「検索 X件 / 全Y件」、非検索時は従来の「X/Y件 完了」

### 新規関数・状態
`listSearchQuery` / `normalizeSearchText` / `currentListSearchQuery` / `deliveryMatchesSearch` / `setListSearchQuery` / `clearListSearch`

---

## Codex へのお願い

1. **二重実装の禁止**: 上記4変更（検索UI・GSIフォールバック・マーカー差分更新・ルート最適化統合）はテスト版に実装済みです
2. **`CODEX_REVIEW_TASKS.md` の更新状況**: TASK-T1（ピンずれ）はあなたの `942bafc` で解決済み。TASK-P1系のマーカー再構築コストは本報告の変更2で解決済み
3. **実機確認のお願い（できれば）**: この変更はコードレビューと構文チェックのみで検証しています。特に以下をテスト版実機で確認してください:
   - ラベルモード切替4種でピンの表示が正しく切り替わるか（差分更新のシグネチャ漏れがないか）
   - 完了/未完了トグルでピンの色・zIndexが即時反映されるか
   - 検索中に完了操作・ナビ・編集ボタンが正しい項目に効くか
   - 存在しない住所での GSI フォールバック発動（コンソールに `geocode fallback via GSI` が出る）
4. **安定版への昇格はユーザー判断**: テスト版で問題がなければ、ユーザーの指示を待って安定版へ反映してください
