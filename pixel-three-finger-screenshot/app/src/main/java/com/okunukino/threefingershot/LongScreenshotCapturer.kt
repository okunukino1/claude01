package com.okunukino.threefingershot

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Path
import android.graphics.Rect
import android.util.Log
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.ArrayDeque
import kotlin.coroutines.resume
import kotlin.math.abs
import kotlin.math.max

/**
 * ロング（スクロール）スクリーンショットの撮影。
 *
 * 仕組み:
 *  1. 現在の画面をキャプチャし、ステータスバー／ナビゲーションバーを切り落とす
 *  2. 画面を1ページ分弱スクロールする（スクロール可能ノードへの ACTION_SCROLL_FORWARD、
 *     ダメならジェスチャー注入によるゆっくりドラッグ）
 *  3. 再キャプチャし、前フレームと行ごとの輝度シグネチャを突き合わせて
 *     実際に何ピクセルスクロールしたかを推定する
 *  4. 新しく現れた下端部分だけを切り出してつなぎ足す
 *  5. スクロールが進まなくなるか上限に達するまで 2〜4 を繰り返す
 */
class LongScreenshotCapturer(
    private val service: ScreenshotAccessibilityService,
    private val maxPages: Int = DEFAULT_MAX_PAGES,
    private val hooks: Hooks? = null,
) {

    /** 停止ボタン等のUIと連携するためのフック。 */
    interface Hooks {
        /** true を返したらそれ以上スクロールせず、撮影済みの分で合成する。 */
        fun shouldStop(): Boolean

        /** 各キャプチャ直前（オーバーレイを隠して写り込みを防ぐ等）。 */
        suspend fun beforeCapture()

        /** 各キャプチャ直後。 */
        suspend fun afterCapture()
    }

    companion object {
        private const val TAG = "LongScreenshot"
        const val DEFAULT_MAX_PAGES = 10
        private const val MAX_TOTAL_HEIGHT = 20000
        private const val SETTLE_DELAY_MS = 750L
    }

    /** 撮影が終了した理由（通知に表示して遠隔デバッグできるようにする） */
    var stopReason: String = ""
        private set

    /** 合成に使ったページ数 */
    var pagesCaptured: Int = 0
        private set

    private suspend fun grabFrame(): Bitmap? {
        hooks?.beforeCapture()
        val bitmap = service.captureFrame(retries = 2)
        hooks?.afterCapture()
        return bitmap
    }

    suspend fun capture(): Bitmap? {
        val (cropTop, cropBottom) = systemBarInsets()
        val firstShot = grabFrame() ?: return null
        val first = crop(firstShot, cropTop, cropBottom)
        if (first !== firstShot) firstShot.recycle()

        val width = first.width
        val frameHeight = first.height

        var prev = first
        var fixedTop = 0
        var fixedBottom = 0
        var regionsDetected = false
        val newParts = mutableListOf<Bitmap>()
        var addedHeight = 0

        try {
            for (page in 1 until maxPages) {
                if (hooks?.shouldStop() == true) {
                    stopReason = "停止ボタン"
                    break
                }
                if (frameHeight + addedHeight >= MAX_TOTAL_HEIGHT) {
                    stopReason = "高さ上限"
                    break
                }
                if (!scrollForward()) {
                    stopReason = "スクロール失敗"
                    break
                }
                delay(SETTLE_DELAY_MS)
                if (hooks?.shouldStop() == true) {
                    stopReason = "停止ボタン"
                    break
                }

                val shot = grabFrame()
                if (shot == null) {
                    stopReason = "撮影失敗(code=${service.lastScreenshotError})"
                    break
                }
                val cur = crop(shot, cropTop, cropBottom)
                if (cur !== shot) shot.recycle()

                if (cur.width != width || cur.height != frameHeight) {
                    stopReason = "画面サイズ変化"
                    cur.recycle()
                    break
                }

                // 最初のスクロール後に、スクロールしても動かない領域
                // （固定ヘッダー・固定フッター/入力バー等）を検出する
                if (!regionsDetected) {
                    val fixed = detectFixedRegions(prev, cur)
                    fixedTop = fixed.first
                    fixedBottom = fixed.second
                    regionsDetected = true
                    Log.i(TAG, "fixed header=$fixedTop footer=$fixedBottom")
                }

                val scrolled = estimateScroll(prev, cur, fixedTop, fixedBottom)
                Log.i(TAG, "page=$page scrolled=$scrolled")
                if (scrolled <= 0) {
                    // スクロールできる部分が動いていない＝最下部に到達
                    stopReason = "最下部と判定"
                    cur.recycle()
                    break
                }

                // 新しく現れたのは「固定フッターのすぐ上」までの scrolled px 分
                val contentBottom = frameHeight - fixedBottom
                val part = Bitmap.createBitmap(cur, 0, contentBottom - scrolled, width, scrolled)
                newParts.add(part)
                addedHeight += scrolled

                if (prev !== first) prev.recycle()
                prev = cur
            }

            if (stopReason.isEmpty()) stopReason = "ページ上限"
            pagesCaptured = newParts.size + 1

            val totalHeight = frameHeight + addedHeight
            val result = Bitmap.createBitmap(width, totalHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(result)

            // 1枚目: 先頭から固定フッターの手前まで（固定ヘッダーはここに1回だけ入る）
            val firstBottom = frameHeight - fixedBottom
            canvas.drawBitmap(
                first,
                Rect(0, 0, width, firstBottom),
                Rect(0, 0, width, firstBottom),
                null
            )
            var y = firstBottom
            for (part in newParts) {
                canvas.drawBitmap(part, 0f, y.toFloat(), null)
                y += part.height
            }
            // 固定フッターは最後のフレームのものを末尾に1回だけ描く
            if (fixedBottom > 0) {
                canvas.drawBitmap(
                    prev,
                    Rect(0, firstBottom, width, frameHeight),
                    Rect(0, y, width, y + fixedBottom),
                    null
                )
            }
            return result
        } finally {
            if (prev !== first && !prev.isRecycled) prev.recycle()
            if (!first.isRecycled) first.recycle()
            newParts.forEach { if (!it.isRecycled) it.recycle() }
        }
    }

    // ---- スクロール ----------------------------------------------------

    private suspend fun scrollForward(): Boolean {
        // まずはゆっくりしたドラッグを注入する（スクロール量を制御しやすい）
        repeat(2) { attempt ->
            if (dispatchSlowSwipeUp()) return true
            Log.w(TAG, "swipe dispatch failed (attempt=$attempt)")
            delay(400)
        }
        // ダメならスクロール可能ノードに直接アクションを投げる
        val node = findScrollableNode() ?: return false
        return node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
    }

    /**
     * フリング（慣性スクロール）にならないよう、ゆっくりドラッグして
     * 最後に指を止めてから離す2段階ジェスチャーを注入する。
     */
    private suspend fun dispatchSlowSwipeUp(): Boolean {
        val bounds = screenBounds()
        val x = bounds.width() / 2f
        val startY = bounds.height() * 0.78f
        val endY = bounds.height() * 0.22f

        val movePath = Path().apply {
            moveTo(x, startY)
            lineTo(x, endY)
        }
        val moveStroke = GestureDescription.StrokeDescription(movePath, 0, 800, true)
        if (!dispatch(GestureDescription.Builder().addStroke(moveStroke).build())) return false

        val holdPath = Path().apply {
            moveTo(x, endY)
            lineTo(x, endY - 1f)
        }
        val holdStroke = moveStroke.continueStroke(holdPath, 0, 300, false)
        if (!dispatch(GestureDescription.Builder().addStroke(holdStroke).build())) {
            // ドラッグ本体は完了しているので、離す動作の失敗は致命的ではない
            Log.w(TAG, "hold-release stroke was cancelled; continuing")
        }
        return true
    }

    private suspend fun dispatch(gesture: GestureDescription): Boolean =
        suspendCancellableCoroutine { cont ->
            val dispatched = service.dispatchGesture(
                gesture,
                object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        cont.resume(true)
                    }

                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        cont.resume(false)
                    }
                },
                null
            )
            if (!dispatched) cont.resume(false)
        }

    private fun findScrollableNode(): AccessibilityNodeInfo? {
        val root = service.rootInActiveWindow ?: return null
        var best: AccessibilityNodeInfo? = null
        var bestArea = 0L
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        val bounds = Rect()
        while (queue.isNotEmpty()) {
            val node = queue.poll() ?: continue
            if (node.isVisibleToUser && node.isScrollable &&
                node.actionList.contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_SCROLL_FORWARD)
            ) {
                node.getBoundsInScreen(bounds)
                val area = bounds.width().toLong() * bounds.height()
                if (area > bestArea) {
                    bestArea = area
                    best = node
                }
            }
            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { queue.add(it) }
            }
        }
        return best
    }

    // ---- 画像処理 -------------------------------------------------------

    /**
     * 前フレームと現フレームを比較し、実際にスクロールした量(px)を推定する。
     * 一致が見つからない／ほぼ動いていない場合は 0 を返す。
     */
    private fun estimateScroll(prev: Bitmap, cur: Bitmap, fixedTop: Int, fixedBottom: Int): Int {
        val h = prev.height
        if (cur.height != h || cur.width != prev.width) return 0

        val sigPrev = rowSignatures(prev)
        val sigCur = rowSignatures(cur)

        // 固定領域を除いた「実際にスクロールする部分」だけで比較する。
        // ここを含めてしまうと固定フッターの一致で s=0 が最良になり、
        // 1スクロールで「最下部」と誤判定してしまう。
        val lo = fixedTop
        val hi = h - fixedBottom
        val contentHeight = hi - lo
        if (contentHeight < 64) return 0

        val cost0 = alignmentCost(sigPrev, sigCur, 0, lo, hi)
        val minS = max(8, contentHeight / 12)
        val maxS = contentHeight * 9 / 10

        var bestS = 0
        var bestCost = Double.MAX_VALUE
        var s = minS
        while (s <= maxS) {
            val cost = alignmentCost(sigPrev, sigCur, s, lo, hi)
            if (cost < bestCost) {
                bestCost = cost
                bestS = s
            }
            s++
        }

        Log.i(TAG, "estimateScroll best=$bestS cost=%.1f cost0=%.1f content=$contentHeight"
            .format(bestCost, cost0))

        // s=0（スクロールしていない）が最良なら最下部に到達したとみなす。
        // そうでなければ最良のオフセットを常に採用して続行する。
        return if (cost0 <= bestCost) 0 else bestS
    }

    /**
     * スクロールしても内容が変わらない領域（固定ヘッダー・固定フッター）を検出する。
     * 上下それぞれについて、前後フレームで同一の行が連続する長さを数える。
     */
    private fun detectFixedRegions(prev: Bitmap, cur: Bitmap): Pair<Int, Int> {
        val h = prev.height
        val samplesPrev = rowSamples(prev)
        val samplesCur = rowSamples(cur)
        val maxFixed = (h * 0.4).toInt()

        var top = 0
        while (top < maxFixed && rowsSimilar(samplesPrev[top], samplesCur[top])) top++

        var bottom = 0
        while (bottom < maxFixed &&
            rowsSimilar(samplesPrev[h - 1 - bottom], samplesCur[h - 1 - bottom])
        ) bottom++

        // 動く部分が小さすぎる場合は検出失敗（画面全体が静止していた等）とみなす
        if (h - top - bottom < h / 3) return 0 to 0
        return top to bottom
    }

    /** 各行から等間隔にサンプリングした画素の配列。固定領域の判定に使う。 */
    private fun rowSamples(bitmap: Bitmap, columns: Int = 24): Array<IntArray> {
        val w = bitmap.width
        val h = bitmap.height
        val xs = IntArray(columns) { (it + 1) * w / (columns + 1) }
        val row = IntArray(w)
        return Array(h) { y ->
            bitmap.getPixels(row, 0, w, 0, y, w, 1)
            IntArray(columns) { i -> row[xs[i]] }
        }
    }

    /** 2行が（わずかな描画差を許容して）同一かどうか。 */
    private fun rowsSimilar(a: IntArray, b: IntArray): Boolean {
        for (i in a.indices) {
            val p = a[i]
            val q = b[i]
            if (abs((p ushr 16 and 0xFF) - (q ushr 16 and 0xFF)) > 10) return false
            if (abs((p ushr 8 and 0xFF) - (q ushr 8 and 0xFF)) > 10) return false
            if (abs((p and 0xFF) - (q and 0xFF)) > 10) return false
        }
        return true
    }

    /** prev を s ピクセル上へずらして cur と重ねたときの、[lo, hi) 範囲の平均絶対差。 */
    private fun alignmentCost(
        sigPrev: DoubleArray,
        sigCur: DoubleArray,
        s: Int,
        lo: Int,
        hi: Int,
    ): Double {
        var cost = 0.0
        var count = 0
        var y = lo
        while (y + s < hi) {
            cost += abs(sigPrev[y + s] - sigCur[y])
            count++
            y += 3
        }
        if (count < 16) return Double.MAX_VALUE
        return cost / count
    }

    /** 各行の平均輝度（0〜255）を返す。横方向は間引いてサンプリングする。 */
    private fun rowSignatures(bitmap: Bitmap): DoubleArray {
        val w = bitmap.width
        val h = bitmap.height
        val step = max(1, w / 96)
        val row = IntArray(w)
        val sig = DoubleArray(h)
        for (y in 0 until h) {
            bitmap.getPixels(row, 0, w, 0, y, w, 1)
            var sum = 0L
            var count = 0
            var x = 0
            while (x < w) {
                val c = row[x]
                sum += (c ushr 16 and 0xFF) + (c ushr 8 and 0xFF) + (c and 0xFF)
                count++
                x += step
            }
            sig[y] = sum.toDouble() / (count * 3)
        }
        return sig
    }

    private fun crop(bitmap: Bitmap, top: Int, bottom: Int): Bitmap {
        val height = (bitmap.height - top - bottom).coerceAtLeast(1)
        if (top == 0 && bottom == 0) return bitmap
        return Bitmap.createBitmap(bitmap, 0, top.coerceAtMost(bitmap.height - 1), bitmap.width, height)
    }

    private fun systemBarInsets(): Pair<Int, Int> {
        val metrics = service.getSystemService(WindowManager::class.java).currentWindowMetrics
        val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
            WindowInsets.Type.statusBars() or
                WindowInsets.Type.navigationBars() or
                WindowInsets.Type.displayCutout()
        )
        return insets.top to insets.bottom
    }

    private fun screenBounds(): Rect =
        service.getSystemService(WindowManager::class.java).currentWindowMetrics.bounds
}
