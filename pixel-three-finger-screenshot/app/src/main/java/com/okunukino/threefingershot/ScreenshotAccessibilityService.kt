package com.okunukino.threefingershot

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.TouchInteractionController
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.min

/**
 * 3本指スワイプでスクリーンショットを撮るユーザー補助サービス。
 *
 * - 3本指で下にスワイプ → 通常のスクリーンショット
 * - 3本指で上にスワイプ → 自動スクロールしながらロングスクリーンショット
 *
 * ジェスチャー検出には Android 13+ の TouchInteractionController を使う。
 * タッチイベントはまず ThreeFingerGestureDetector に届き、3本指スワイプ
 * だけを取り出して、それ以外は即座に通常の入力パイプラインへ委譲する。
 * （フレームワーク標準のマルチフィンガージェスチャー検出＋全画面パススルーは
 * 「パススルー領域内で始まったタッチはジェスチャー検出自体をスキップして委譲」
 * という仕様のため使えない）
 */
class ScreenshotAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "ThreeFingerShot"
        const val NOTIFICATION_CHANNEL_ID = "screenshots"

        @Volatile
        var instance: ScreenshotAccessibilityService? = null
            private set
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var touchController: TouchInteractionController? = null

    @Volatile
    private var busy = false

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // タッチをこちらで分類するモード。3本指スワイプ以外は
            // 検出器が即座に委譲するため通常操作には影響しない。
            serviceInfo = serviceInfo?.apply {
                flags = flags or AccessibilityServiceInfo.FLAG_REQUEST_TOUCH_EXPLORATION_MODE
            }
            val controller = getTouchInteractionController(Display.DEFAULT_DISPLAY)
            val detector = ThreeFingerGestureDetector(this, controller) { isDown ->
                if (isDown) {
                    requestSingleScreenshot(delayMs = 300)
                } else {
                    requestLongScreenshot(delayMs = 300)
                }
            }
            controller.registerCallback(mainExecutor, detector)
            touchController = controller
            Log.i(TAG, "service connected (TouchInteractionController mode)")
        } else {
            // Android 11-12: 通常操作を壊さずに3本指を検出する手段がないため、
            // ジェスチャーは無効。クイック設定タイルとアプリ内ボタンのみ使える。
            Log.i(TAG, "service connected (gesture unsupported below Android 13)")
        }
    }

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            touchController?.unregisterAllCallbacks()
            touchController = null
        }
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        scope.cancel()
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    /** 通常のスクリーンショット。delayMs は指が画面から離れるのを待つ猶予。 */
    fun requestSingleScreenshot(delayMs: Long = 0) {
        if (!markBusy()) return
        scope.launch {
            try {
                if (delayMs > 0) delay(delayMs)
                val bitmap = captureFrame(retries = 2)
                if (bitmap == null) {
                    toast(getString(R.string.toast_failed))
                    return@launch
                }
                saveAndNotify(bitmap, isLong = false)
            } finally {
                busy = false
            }
        }
    }

    /** ロング（スクロール）スクリーンショット。 */
    fun requestLongScreenshot(delayMs: Long = 0) {
        if (!markBusy()) return
        scope.launch {
            try {
                if (delayMs > 0) delay(delayMs)
                toast(getString(R.string.toast_long_start))
                delay(400)
                val bitmap = LongScreenshotCapturer(this@ScreenshotAccessibilityService).capture()
                if (bitmap == null) {
                    toast(getString(R.string.toast_failed))
                    return@launch
                }
                saveAndNotify(bitmap, isLong = true)
            } finally {
                busy = false
            }
        }
    }

    /** クイック設定タイルから：通知シェードを閉じてから撮影する。 */
    fun requestSingleScreenshotFromTile() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
        } else {
            performGlobalAction(GLOBAL_ACTION_BACK)
        }
        requestSingleScreenshot(delayMs = 800)
    }

    private fun markBusy(): Boolean {
        if (busy) {
            toast(getString(R.string.toast_capturing))
            return false
        }
        busy = true
        return true
    }

    private suspend fun saveAndNotify(bitmap: Bitmap, isLong: Boolean) {
        val prefix = if (isLong) "LongScreenshot" else "Screenshot"
        val uri = ScreenshotSaver.save(this, bitmap, prefix)
        if (uri == null) {
            toast(getString(R.string.toast_failed))
        } else {
            toast(getString(if (isLong) R.string.toast_long_saved else R.string.toast_saved))
            showSavedNotification(uri, bitmap, isLong)
        }
        bitmap.recycle()
    }

    /**
     * 画面をキャプチャして software bitmap で返す。
     * システム側のレート制限（連続撮影の最短間隔）に備えてリトライする。
     */
    suspend fun captureFrame(retries: Int = 1): Bitmap? {
        repeat(retries + 1) { attempt ->
            val bitmap = captureOnce()
            if (bitmap != null) return bitmap
            if (attempt < retries) delay(450)
        }
        return null
    }

    private suspend fun captureOnce(): Bitmap? = suspendCancellableCoroutine { cont ->
        try {
            takeScreenshot(
                Display.DEFAULT_DISPLAY,
                mainExecutor,
                object : TakeScreenshotCallback {
                    override fun onSuccess(screenshot: ScreenshotResult) {
                        val buffer = screenshot.hardwareBuffer
                        val bitmap = Bitmap.wrapHardwareBuffer(buffer, screenshot.colorSpace)
                            ?.copy(Bitmap.Config.ARGB_8888, false)
                        buffer.close()
                        cont.resume(bitmap)
                    }

                    override fun onFailure(errorCode: Int) {
                        Log.w(TAG, "takeScreenshot failed: $errorCode")
                        cont.resume(null)
                    }
                }
            )
        } catch (t: Throwable) {
            Log.e(TAG, "takeScreenshot threw", t)
            cont.resume(null)
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notif_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun showSavedNotification(uri: Uri, bitmap: Bitmap, isLong: Boolean) {
        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "image/png")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, viewIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        // 縦長画像は上部だけをサムネイルにする
        val previewHeight = min(bitmap.height, bitmap.width * 2)
        val preview = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, previewHeight)
        val scale = 512f / preview.width
        val thumbnail = Bitmap.createScaledBitmap(
            preview, 512, (preview.height * scale).toInt().coerceAtLeast(1), true
        )
        if (preview !== bitmap && preview !== thumbnail) preview.recycle()

        val notification = Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_screenshot)
            .setContentTitle(getString(if (isLong) R.string.notif_long_saved_title else R.string.notif_saved_title))
            .setContentText(getString(R.string.notif_saved_text))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setStyle(Notification.BigPictureStyle().bigPicture(thumbnail))
            .build()

        getSystemService(NotificationManager::class.java)
            .notify((System.currentTimeMillis() and 0x7FFFFFFF).toInt(), notification)
    }

    fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }
}
