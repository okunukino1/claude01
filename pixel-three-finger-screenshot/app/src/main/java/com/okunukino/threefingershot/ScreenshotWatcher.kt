package com.okunukino.threefingershot

import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Log

/**
 * システム（背面2回タップのクイックタップや電源+音量下など）で撮影された
 * スクリーンショットの保存を MediaStore の変更通知で検知する。
 *
 * 検知したら onSystemScreenshot を呼ぶ（→「ロングにしますか？」ポップアップ）。
 * 本アプリ自身が保存したファイル（3FS_ プレフィックス）は無視する。
 * 画像の読み取りには READ_MEDIA_IMAGES 権限が必要（未許可なら何もしない）。
 */
class ScreenshotWatcher(
    private val service: ScreenshotAccessibilityService,
    private val onSystemScreenshot: () -> Unit,
) : ContentObserver(Handler(Looper.getMainLooper())) {

    companion object {
        private const val TAG = "ScreenshotWatcher"
        private const val DEBOUNCE_MS = 4000L
        private const val MAX_AGE_SECONDS = 15L
    }

    private var lastFiredAt = 0L

    fun register() {
        service.contentResolver.registerContentObserver(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, this
        )
    }

    fun unregister() {
        runCatching { service.contentResolver.unregisterContentObserver(this) }
    }

    override fun onChange(selfChange: Boolean, uri: Uri?) {
        if (uri == null) return
        val now = System.currentTimeMillis()
        if (now - lastFiredAt < DEBOUNCE_MS) return
        try {
            service.contentResolver.query(
                uri,
                arrayOf(
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.RELATIVE_PATH,
                    MediaStore.Images.Media.DATE_ADDED,
                ),
                null, null, null
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return
                val name = cursor.getString(0) ?: return
                val relativePath = cursor.getString(1) ?: ""
                val dateAddedSec = cursor.getLong(2)

                if (ScreenshotSaver.isOwnFile(name)) return
                val looksLikeScreenshot =
                    relativePath.contains("screenshot", ignoreCase = true) ||
                        name.startsWith("Screenshot", ignoreCase = true)
                if (!looksLikeScreenshot) return
                if (now / 1000 - dateAddedSec > MAX_AGE_SECONDS) return

                lastFiredAt = now
                Log.i(TAG, "system screenshot detected: $name")
                onSystemScreenshot()
            }
        } catch (t: Throwable) {
            // 権限未許可(SecurityException)や一時的なクエリ失敗は無視
            Log.w(TAG, "query failed: $t")
        }
    }
}
