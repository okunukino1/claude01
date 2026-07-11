package com.okunukino.threefingershot

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** 撮影した Bitmap を MediaStore 経由で Pictures/Screenshots に PNG 保存する。 */
object ScreenshotSaver {

    private const val TAG = "ScreenshotSaver"

    /** 本アプリが保存したファイルの目印（ScreenshotWatcher が自分の保存を無視するため） */
    private const val OWN_PREFIX = "3FS_"

    fun isOwnFile(displayName: String): Boolean = displayName.startsWith(OWN_PREFIX)

    fun save(context: Context, bitmap: Bitmap, prefix: String): Uri? {
        val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "$OWN_PREFIX${prefix}_$timestamp.png"

        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(
                MediaStore.Images.Media.RELATIVE_PATH,
                Environment.DIRECTORY_PICTURES + "/Screenshots"
            )
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }

        val resolver = context.contentResolver
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: return null

        return try {
            resolver.openOutputStream(uri)?.use { stream ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
                    throw IllegalStateException("bitmap compress failed")
                }
            } ?: throw IllegalStateException("openOutputStream returned null")

            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            uri
        } catch (t: Throwable) {
            Log.e(TAG, "failed to save screenshot", t)
            resolver.delete(uri, null, null)
            null
        }
    }
}
