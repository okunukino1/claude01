package com.rys.deliverymap;

import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // camera-preview (toBack) 用: WebView自体を透明にしないと
    // 背後のカメラ映像が白背景に隠れて見えない
    this.bridge.getWebView().setBackgroundColor(Color.TRANSPARENT);
  }
}
