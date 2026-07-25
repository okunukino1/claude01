package com.okunukino.threefingershot

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * ユーザー補助サービスから出すオーバーレイUI。
 * TYPE_ACCESSIBILITY_OVERLAY はユーザー補助サービスなら追加権限なしで使える。
 *
 * - 確認ポップアップ:「ロングスクリーンショットにしますか？ [はい][✕]」
 * - スクロール撮影中の「■ 停止」ボタン
 *   （撮影の瞬間は INVISIBLE にして画像に写り込まないようにする）
 */
class OverlayController(private val service: AccessibilityService) {

    companion object {
        private const val PROMPT_AUTO_HIDE_MS = 8000L
    }

    private val windowManager = service.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var promptView: View? = null
    private var stopView: View? = null
    private val hidePromptRunnable = Runnable { removePrompt() }

    fun showPrompt(onYes: () -> Unit) {
        removePrompt()

        val row = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#EE202124"))
                cornerRadius = dp(28).toFloat()
            }
        }

        val messageView = TextView(service).apply {
            text = service.getString(R.string.prompt_long_question)
            setTextColor(Color.WHITE)
            textSize = 14f
            maxLines = 2
        }
        val yesButton = pillButton(service.getString(R.string.prompt_yes), "#FF1A73E8") {
            removePrompt()
            onYes()
        }
        val closeButton = pillButton(service.getString(R.string.prompt_close), "#FF5F6368") {
            removePrompt()
        }

        // メッセージ側だけを伸縮させ、ボタンは常に画面内に収まるようにする
        row.addView(
            messageView,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        val buttonParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { leftMargin = dp(8) }
        row.addView(yesButton, buttonParams)
        row.addView(closeButton, buttonParams)

        // 画面幅いっぱいに広げたうえで左右に余白を取る（はみ出して✕が切れるのを防ぐ）
        val container = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(12), 0, dp(12), 0)
            addView(
                row,
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }

        addOverlay(container, yOffset = dp(150), matchWidth = true)
        promptView = container
        handler.postDelayed(hidePromptRunnable, PROMPT_AUTO_HIDE_MS)
    }

    /** 余白の小さい丸型ボタン（標準 Button は最小幅が広く画面をはみ出すため自作する） */
    private fun pillButton(label: String, colorHex: String, onClick: () -> Unit): TextView =
        TextView(service).apply {
            text = label
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(dp(16), dp(10), dp(16), dp(10))
            background = GradientDrawable().apply {
                setColor(Color.parseColor(colorHex))
                cornerRadius = dp(22).toFloat()
            }
            isClickable = true
            setOnClickListener { onClick() }
        }

    fun showStopButton(onStop: () -> Unit) {
        removeStop()
        val button = TextView(service).apply {
            text = service.getString(R.string.stop_button)
            setTextColor(Color.WHITE)
            textSize = 16f
            setPadding(dp(28), dp(14), dp(28), dp(14))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#EED93025"))
                cornerRadius = dp(32).toFloat()
            }
            setOnClickListener {
                isClickable = false
                text = service.getString(R.string.stop_button_stopping)
                onStop()
            }
        }
        addOverlay(button, yOffset = dp(120))
        stopView = button
    }

    /** 撮影の瞬間に写り込まないよう表示/非表示を切り替える。 */
    fun setStopButtonVisible(visible: Boolean) {
        stopView?.visibility = if (visible) View.VISIBLE else View.INVISIBLE
    }

    fun removePrompt() {
        handler.removeCallbacks(hidePromptRunnable)
        promptView?.let { view -> runCatching { windowManager.removeView(view) } }
        promptView = null
    }

    fun removeStop() {
        stopView?.let { view -> runCatching { windowManager.removeView(view) } }
        stopView = null
    }

    fun removeAll() {
        removePrompt()
        removeStop()
    }

    private fun addOverlay(view: View, yOffset: Int, matchWidth: Boolean = false) {
        val params = WindowManager.LayoutParams(
            if (matchWidth) {
                WindowManager.LayoutParams.MATCH_PARENT
            } else {
                WindowManager.LayoutParams.WRAP_CONTENT
            },
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = yOffset
        }
        runCatching { windowManager.addView(view, params) }
    }

    private fun dp(value: Int): Int =
        (value * service.resources.displayMetrics.density).toInt()
}
