package com.avicagan.household;

import com.getcapacitor.BridgeActivity;

/*
  No plugins of our own to register now that the Bluetooth app is gone. If one
  comes back, register it in onCreate BEFORE super.onCreate: the bridge builds
  its plugin registry during that call, so anything added afterwards is
  missing from the WebView and every call into it rejects as "not implemented".
*/
public class MainActivity extends BridgeActivity {}
