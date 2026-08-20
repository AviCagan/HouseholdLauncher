package com.avicagan.household;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate: the bridge builds its plugin
        // registry during that call, so anything added afterwards is missing
        // from the WebView and every call into it rejects as "not implemented".
        registerPlugin(BluetoothControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
