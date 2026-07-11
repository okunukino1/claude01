package com.okunukino.threefingershot

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())

    private val imagesPermission: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            android.Manifest.permission.READ_MEDIA_IMAGES
        } else {
            android.Manifest.permission.READ_EXTERNAL_STORAGE
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.btnOpenAccessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        findViewById<Button>(R.id.btnGrantImages).setOnClickListener {
            requestPermissions(arrayOf(imagesPermission), 2)
        }

        findViewById<Switch>(R.id.switchThreeFinger).apply {
            isChecked = Prefs.threeFingerEnabled(this@MainActivity)
            setOnCheckedChangeListener { _, checked ->
                Prefs.setThreeFingerEnabled(this@MainActivity, checked)
                ScreenshotAccessibilityService.instance?.refreshGestureMode()
            }
        }

        findViewById<Button>(R.id.btnTestSingle).setOnClickListener {
            scheduleTest { it.requestSingleScreenshot() }
        }

        findViewById<Button>(R.id.btnTestLong).setOnClickListener {
            scheduleTest { it.requestLongScreenshot() }
        }

        requestNotificationPermissionIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun updateStatus() {
        val enabled = ScreenshotAccessibilityService.instance != null
        findViewById<TextView>(R.id.statusText).text =
            getString(if (enabled) R.string.status_enabled else R.string.status_disabled)

        val imagesGranted =
            checkSelfPermission(imagesPermission) == PackageManager.PERMISSION_GRANTED
        findViewById<Button>(R.id.btnGrantImages).apply {
            if (imagesGranted) {
                isEnabled = false
                text = getString(R.string.images_granted)
            } else {
                isEnabled = true
                text = getString(R.string.btn_grant_images)
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updateStatus()
    }

    /** ホーム画面などに切り替える猶予として3秒後に撮影する。 */
    private fun scheduleTest(action: (ScreenshotAccessibilityService) -> Unit) {
        if (ScreenshotAccessibilityService.instance == null) {
            Toast.makeText(this, R.string.toast_service_not_running, Toast.LENGTH_LONG).show()
            return
        }
        Toast.makeText(this, R.string.toast_countdown, Toast.LENGTH_SHORT).show()
        handler.postDelayed({
            ScreenshotAccessibilityService.instance?.let(action)
        }, 3000)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }
}
