package com.okunukino.threefingershot

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.accessibilityservice.TouchInteractionController
import android.annotation.TargetApi
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.max

/**
 * TouchInteractionController (Android 13+) を使った3本指スワイプ検出。
 *
 * FLAG_REQUEST_TOUCH_EXPLORATION_MODE + コールバック登録により、
 * タッチイベントはまずこのクラスに届く。方針:
 *
 *  - タッチ開始から最大 DECISION_WINDOW_MS だけ様子を見る
 *  - 3本指が揃ったら自分のものにする（アプリには渡さない）。
 *    平均移動が縦方向にしきい値を超えた時点でスワイプ確定
 *  - 3本指にならないまま「指が動いた／時間切れ／指が離れ始めた」場合は
 *    requestDelegating() で即座に通常の入力パイプラインへ委譲する
 *    （フレームワークが現在の指位置で DOWN を注入するため操作は失われない）
 *  - 委譲する前に終わってしまった素早い1本指タップは performClick() で再現する
 */
@TargetApi(33)
class ThreeFingerGestureDetector(
    private val service: AccessibilityService,
    private val controller: TouchInteractionController,
    /** isDown=true: 3本指下スワイプ / false: 3本指上スワイプ */
    private val onSwipe: (isDown: Boolean) -> Unit,
) : TouchInteractionController.Callback {

    companion object {
        private const val TAG = "3FingerDetector"

        /** 3本目の指を待つ猶予（これを超えたら通常操作として委譲）。
         *  長くするほど3本指を拾いやすいが、通常のタップのもたつきが増える。 */
        private const val DECISION_WINDOW_MS = 70L

        /** 2本指まで揃っている場合に3本目を待つ追加の猶予 */
        private const val EXTENSION_MS = 100L
    }

    private enum class Phase {
        /** 触れていない */
        IDLE,

        /** 様子見中（まだ委譲も確保もしていない） */
        PENDING,

        /** 3本指が揃った。スワイプ判定中（アプリには渡さない） */
        OWNED,

        /** 通常操作として委譲済み */
        DELEGATED,

        /** ジェスチャー発火済み。指が離れるまで何もしない */
        DONE,
    }

    private val handler = Handler(Looper.getMainLooper())
    private val touchSlop = ViewConfiguration.get(service).scaledTouchSlop
    private val delegateSlopSquared =
        (touchSlop * 2f) * (touchSlop * 2f)
    private val triggerDistancePx = 110f * service.resources.displayMetrics.density

    private var phase = Phase.IDLE
    private var extended = false
    private var currentPointerCount = 0
    private var maxPointerCount = 0
    private var firstDownX = 0f
    private var firstDownY = 0f
    private val startX = HashMap<Int, Float>()
    private val startY = HashMap<Int, Float>()

    private val decideRunnable = Runnable { onDecisionWindowElapsed() }

    override fun onMotionEvent(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                resetState()
                phase = Phase.PENDING
                firstDownX = event.x
                firstDownY = event.y
                trackNewPointer(event)
                handler.postDelayed(decideRunnable, DECISION_WINDOW_MS)
            }

            MotionEvent.ACTION_POINTER_DOWN -> {
                trackNewPointer(event)
                if (phase == Phase.PENDING && event.pointerCount >= 3) {
                    handler.removeCallbacks(decideRunnable)
                    phase = Phase.OWNED
                }
            }

            MotionEvent.ACTION_MOVE -> onMove(event)

            MotionEvent.ACTION_POINTER_UP -> {
                currentPointerCount = event.pointerCount - 1
                if (phase == Phase.PENDING) {
                    // 3本指になる前に指が離れ始めた → 通常タッチとして委譲
                    delegate()
                }
            }

            MotionEvent.ACTION_UP -> {
                handler.removeCallbacks(decideRunnable)
                if (phase == Phase.PENDING && maxPointerCount == 1) {
                    // 委譲する前に終わった素早いタップ → 同じ座標にタップを注入して再現する。
                    // （controller.performClick() はアクセシビリティフォーカスされた別の
                    // 要素を押してしまうことがあるため使わない）
                    injectTap(firstDownX, firstDownY)
                }
                resetState()
            }

            MotionEvent.ACTION_CANCEL -> resetState()
        }
    }

    override fun onStateChanged(state: Int) {
        if (state == TouchInteractionController.STATE_CLEAR) {
            resetState()
        }
    }

    private fun onMove(event: MotionEvent) {
        when (phase) {
            Phase.PENDING -> {
                // 3本目が来る前に大きく動いた → スクロール等の通常操作
                for (i in 0 until event.pointerCount) {
                    val id = event.getPointerId(i)
                    val sx = startX[id] ?: continue
                    val sy = startY[id] ?: continue
                    val dx = event.getX(i) - sx
                    val dy = event.getY(i) - sy
                    if (dx * dx + dy * dy > delegateSlopSquared) {
                        delegate()
                        return
                    }
                }
            }

            Phase.OWNED -> {
                var sumDx = 0f
                var sumDy = 0f
                var count = 0
                for (i in 0 until event.pointerCount) {
                    val id = event.getPointerId(i)
                    val sx = startX[id] ?: continue
                    val sy = startY[id] ?: continue
                    sumDx += event.getX(i) - sx
                    sumDy += event.getY(i) - sy
                    count++
                }
                if (count >= 3) {
                    val avgDx = sumDx / count
                    val avgDy = sumDy / count
                    if (abs(avgDy) > triggerDistancePx && abs(avgDy) > abs(avgDx) * 1.5f) {
                        phase = Phase.DONE
                        Log.i(TAG, "3-finger swipe detected, down=${avgDy > 0}")
                        onSwipe(avgDy > 0)
                    }
                }
            }

            else -> Unit
        }
    }

    private fun onDecisionWindowElapsed() {
        if (phase != Phase.PENDING) return
        if (currentPointerCount == 2 && !extended) {
            // 2本まで揃っている: 3本目がわずかに遅れている可能性があるので少しだけ待つ
            extended = true
            handler.postDelayed(decideRunnable, EXTENSION_MS)
        } else {
            delegate()
        }
    }

    private fun delegate() {
        if (phase == Phase.DELEGATED) return
        phase = Phase.DELEGATED
        handler.removeCallbacks(decideRunnable)
        try {
            controller.requestDelegating()
        } catch (t: Throwable) {
            Log.w(TAG, "requestDelegating failed", t)
        }
    }

    private fun injectTap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        try {
            service.dispatchGesture(gesture, null, null)
        } catch (t: Throwable) {
            Log.w(TAG, "injectTap failed", t)
        }
    }

    private fun trackNewPointer(event: MotionEvent) {
        val index = event.actionIndex
        val id = event.getPointerId(index)
        startX[id] = event.getX(index)
        startY[id] = event.getY(index)
        currentPointerCount = event.pointerCount
        maxPointerCount = max(maxPointerCount, event.pointerCount)
    }

    private fun resetState() {
        handler.removeCallbacks(decideRunnable)
        phase = Phase.IDLE
        extended = false
        currentPointerCount = 0
        maxPointerCount = 0
        startX.clear()
        startY.clear()
    }
}
