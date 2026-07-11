package com.okunukino.threefingershot

import android.content.Context

/** アプリ設定（SharedPreferences）。 */
object Prefs {
    private const val FILE = "settings"
    private const val KEY_THREE_FINGER = "three_finger_enabled"

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
