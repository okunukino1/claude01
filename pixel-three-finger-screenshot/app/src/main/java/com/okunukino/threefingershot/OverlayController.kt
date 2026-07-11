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
import android.widget.Button
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

        val container = LinearLayout(service).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#EE202124"))
                cornerRadius = dp(28).toFloat()
            }
        }

        val text = TextView(service).apply {
            text = service.getString(R.string.prompt_long_question)
            setTextColor(Color.WHITE)
            textSize = 15f
        }
        val yesButton = Button(service).apply {
            text = service.getString(R.string.prompt_yes)
            setOnClickListener {
                removePrompt()
                onYes()
            }
        }
        val closeButton = Button(service).apply {
            text = service.getString(R.string.prompt_close)
            setOnClickListener { removePrompt() }
        }

        val buttonParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { leftMargin = dp(8) }
        container.addView(text)
        container.addView(yesButton, buttonParams)
        container.addView(closeButton, buttonParams)

        addOverlay(container, yOffset = dp(150))
        promptView = container
        handler.postDelayed(hidePromptRunnable, PROMPT_AUTO_HIDE_MS)
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

    private fun addOverlay(view: View, yOffset: Int) {
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
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
