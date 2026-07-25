package com.okunukino.threefingershot

import android.content.Context

/** アプリ設定（SharedPreferences）。 */
object Prefs {
    private const val FILE = "settings"
    private const val KEY_THREE_FINGER = "three_finger_enabled"
    private const val KEY_LAST_RESULT = "last_result"

    /** 直近のロングスクショの結果（アプリ画面で確認できるようにする） */
    fun lastResult(context: Context): String =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_LAST_RESULT, "") ?: ""

    fun setLastResult(context: Context, value: String) {
        val stamp = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US)
            .format(java.util.Date())
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_RESULT, "$stamp  $value")
            .apply()
    }

    fun threeFingerEnabled(context: Context): Boolean =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getBoolean(KEY_THREE_FINGER, false)

    fun setThreeFingerEnabled(context: Context, value: Boolean) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_THREE_FINGER, value)
            .apply()
    }
}
