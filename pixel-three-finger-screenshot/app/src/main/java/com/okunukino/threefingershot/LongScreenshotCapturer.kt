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
class LongScreenshotCapturer(private val service: ScreenshotAccessibilityService) {

    companion object {
        private const val TAG = "LongScreenshot"
        private const val MAX_PAGES = 10
        private const val MAX_TOTAL_HEIGHT = 16000
        private const val SETTLE_DELAY_MS = 750L
        // 行シグネチャ(0〜255)の平均絶対差がこの値未満なら「一致」とみなす
        private const val MATCH_THRESHOLD = 12.0
    }

    suspend fun capture(): Bitmap? {
        val firstShot = service.captureFrame(retries = 2) ?: return null
        val (cropTop, cropBottom) = systemBarInsets()

        var prev = crop(firstShot, cropTop, cropBottom)
        if (prev !== firstShot) firstShot.recycle()

        val width = prev.width
        val pageHeight = prev.height
        val pieces = mutableListOf(prev)
        var totalHeight = prev.height

        try {
            for (page in 1 until MAX_PAGES) {
                if (totalHeight >= MAX_TOTAL_HEIGHT) break
                if (!scrollForward()) break
                delay(SETTLE_DELAY_MS)

                val shot = service.captureFrame(retries = 2) ?: break
                val cur = crop(shot, cropTop, cropBottom)
                if (cur !== shot) shot.recycle()

                val scrolled = estimateScroll(prev, cur)
                Log.i(TAG, "page=$page scrolled=$scrolled")
                if (scrolled < pageHeight / 12) {
                    // ほぼ動いていない＝最下部に到達
                    cur.recycle()
                    break
                }

                val newPart = Bitmap.createBitmap(cur, 0, cur.height - scrolled, width, scrolled)
                pieces.add(newPart)
                totalHeight += scrolled

                if (prev !== pieces[0]) prev.recycle()
                prev = cur
            }

            if (pieces.size == 1) {
                // スクロールできなかった場合は1画面分をそのまま返す
                return pieces[0].copy(Bitmap.Config.ARGB_8888, false)
            }

            val result = Bitmap.createBitmap(width, totalHeight, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(result)
            var y = 0f
            for (piece in pieces) {
                canvas.drawBitmap(piece, 0f, y, null)
                y += piece.height
            }
            return result
        } finally {
            if (prev !== pieces.firstOrNull() && !prev.isRecycled) prev.recycle()
            pieces.forEach { if (!it.isRecycled) it.recycle() }
        }
    }

    // ---- スクロール ----------------------------------------------------

    private suspend fun scrollForward(): Boolean {
        // まずはゆっくりしたドラッグを注入する（スクロール量を制御しやすい）
        if (dispatchSlowSwipeUp()) return true
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
        val startY = bounds.height() * 0.72f
        val endY = bounds.height() * 0.30f

        val movePath = Path().apply {
            moveTo(x, startY)
            lineTo(x, endY)
        }
        val moveStroke = GestureDescription.StrokeDescription(movePath, 0, 700, true)
        if (!dispatch(GestureDescription.Builder().addStroke(moveStroke).build())) return false

        val holdPath = Path().apply {
            moveTo(x, endY)
            lineTo(x, endY - 1f)
        }
        val holdStroke = moveStroke.continueStroke(holdPath, 0, 300, false)
        return dispatch(GestureDescription.Builder().addStroke(holdStroke).build())
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
    private fun estimateScroll(prev: Bitmap, cur: Bitmap): Int {
        val h = prev.height
        if (cur.height != h || cur.width != prev.width) return 0

        val sigPrev = rowSignatures(prev)
        val sigCur = rowSignatures(cur)

        val cost0 = alignmentCost(sigPrev, sigCur, 0)
        val minS = h / 12
        val maxS = h * 9 / 10

        var bestS = 0
        var bestCost = Double.MAX_VALUE
        var s = minS
        while (s <= maxS) {
            val cost = alignmentCost(sigPrev, sigCur, s)
            if (cost < bestCost) {
                bestCost = cost
                bestS = s
            }
            s++
        }

        // 全く同じ画面（スクロールが効かなかった）場合
        if (cost0 < MATCH_THRESHOLD && cost0 <= bestCost) return 0
        return if (bestCost < MATCH_THRESHOLD) bestS else 0
    }

    /** prev を s ピクセル上へずらして cur と重ねたときの行シグネチャ平均絶対差。 */
    private fun alignmentCost(sigPrev: DoubleArray, sigCur: DoubleArray, s: Int): Double {
        val overlap = sigPrev.size - s
        if (overlap < 16) return Double.MAX_VALUE
        var cost = 0.0
        var count = 0
        var y = 0
        while (y < overlap) {
            cost += abs(sigPrev[y + s] - sigCur[y])
            count++
            y += 3
        }
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
