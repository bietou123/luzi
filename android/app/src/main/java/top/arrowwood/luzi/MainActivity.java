package top.arrowwood.luzi;

import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // webview 初始化期也保持深色，避免冷启动白屏闪烁
        getBridge().getWebView().setBackgroundColor(Color.parseColor("#0d0f16"));
    }
}
