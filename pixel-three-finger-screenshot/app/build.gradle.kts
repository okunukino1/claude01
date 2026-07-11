plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.okunukino.threefingershot"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.okunukino.threefingershot"
        minSdk = 30 // Android 11: マルチフィンガージェスチャー / takeScreenshot API が必須
        targetSdk = 34
        versionCode = 5
        versionName = "1.3.1"
    }

    // CIの使い捨て環境で毎回別の鍵が生成されると上書きインストールできなくなるため、
    // リポジトリ内の固定debugキーで署名する（個人利用のサイドロード用途）
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("signing/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
