package com.avicagan.household;

import android.Manifest;
import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.Set;

/**
 * Connect and disconnect already-paired Bluetooth devices.
 *
 * The problem this solves: with the car stereo and a pair of headphones both
 * paired, the phone grabs whichever it sees first, and steering that means
 * four taps deep into system settings — per device, every time. This turns it
 * into one switch per device on one screen.
 *
 * <h2>Why reflection</h2>
 *
 * {@link BluetoothA2dp} and {@link BluetoothHeadset} both carry {@code connect}
 * and {@code disconnect} methods, and neither is in the public SDK: they are
 * annotated {@code @hide}, so they compile only against the internal framework.
 * They have been present and unchanged since API 11 and are what the Settings
 * app itself calls, but an app can only reach them by name at runtime.
 *
 * Everything here treats their absence as ordinary. A future Android that
 * removes or renames them produces a normal "couldn't do that" in the UI
 * rather than a crash — reflection failures are caught and reported, never
 * thrown across the bridge.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * Nothing here unpairs a device. Disconnecting leaves the bond intact, so
 * reconnecting is one tap and never re-runs pairing. That distinction is the
 * whole feature: unpairing the car to stop it grabbing audio would mean
 * re-pairing it in the driveway.
 */
@CapacitorPlugin(
    name = "BluetoothControl",
    permissions = {
        @Permission(
            alias = BluetoothControlPlugin.BT_PERMISSION,
            // BLUETOOTH_CONNECT is the Android 12+ runtime permission. On
            // older versions it does not exist and the legacy install-time
            // BLUETOOTH grant applies instead, which is why the request path
            // below short-circuits there rather than asking for something the
            // platform will never prompt for.
            strings = { Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class BluetoothControlPlugin extends Plugin {

    static final String BT_PERMISSION = "bluetooth";

    /** Profiles worth steering. Both are audio; the rest are not the problem. */
    private static final int[] PROFILES = { BluetoothProfile.A2DP, BluetoothProfile.HEADSET };

    private BluetoothAdapter adapter() {
        Context context = getContext();
        BluetoothManager manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }

    /**
     * True when the app may talk to the adapter at all.
     *
     * Below Android 12 there is no runtime permission to hold, so the answer
     * is simply yes — checking for BLUETOOTH_CONNECT there returns denied
     * forever and would lock the whole screen behind a prompt that can never
     * appear.
     */
    private boolean hasBtPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
            == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            result.put("supported", false);
            result.put("reason", "This device has no Bluetooth adapter.");
        } else {
            result.put("supported", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBtPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasBtPermission()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias(BT_PERMISSION, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasBtPermission());
        call.resolve(result);
    }

    /**
     * Every paired device, with whether it is currently connected.
     *
     * Connection state is not a property of the device — it is per profile, and
     * only the profile proxy knows it. So the proxies for A2DP and Headset are
     * opened, their connected-device lists collected, and the union taken:
     * "connected" here means connected on at least one audio profile, which is
     * what someone looking at the screen means by it.
     */
    @PluginMethod
    public void listDevices(final PluginCall call) {
        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth adapter.");
            return;
        }
        if (!hasBtPermission()) {
            call.reject("Bluetooth permission has not been granted.");
            return;
        }

        final JSObject result = new JSObject();
        result.put("adapterOn", adapter.isEnabled());

        // A disabled adapter still reports its bonded devices, so the list is
        // built either way — the UI shows them greyed with a "turn Bluetooth
        // on" hint rather than an empty screen that looks like a failure.
        Set<BluetoothDevice> bonded;
        try {
            bonded = adapter.getBondedDevices();
        } catch (SecurityException e) {
            call.reject("Bluetooth permission has not been granted.");
            return;
        }
        if (bonded == null) bonded = new HashSet<>();

        final Set<BluetoothDevice> devices = bonded;

        withProfiles(adapter, new ProfilesReady() {
            @Override
            public void run(BluetoothProfile a2dp, BluetoothProfile headset) {
                Set<String> connected = new HashSet<>();
                collectConnected(a2dp, connected);
                collectConnected(headset, connected);

                JSArray list = new JSArray();
                for (BluetoothDevice device : devices) {
                    JSObject entry = new JSObject();
                    String address = device.getAddress();
                    entry.put("address", address);

                    String name;
                    try {
                        name = device.getName();
                    } catch (SecurityException e) {
                        name = null;
                    }
                    entry.put("name", name == null || name.isEmpty() ? address : name);
                    entry.put("connected", connected.contains(address));
                    entry.put("kind", classify(device));

                    JSArray profiles = new JSArray();
                    if (supports(a2dp, device)) profiles.put("a2dp");
                    if (supports(headset, device)) profiles.put("headset");
                    entry.put("profiles", profiles);

                    list.put(entry);
                }

                result.put("devices", list);
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        changeConnection(call, "disconnect");
    }

    @PluginMethod
    public void connect(PluginCall call) {
        changeConnection(call, "connect");
    }

    /**
     * Call {@code connect} or {@code disconnect} on both audio profiles.
     *
     * Both are attempted rather than picking one, because a device may be
     * carried on either or both — a car is usually A2DP plus Headset, cheap
     * headphones often A2DP alone. Success on ANY profile counts: reporting
     * failure because the headset profile refused, while audio actually
     * stopped, would send someone back into system settings for a change that
     * already happened.
     */
    private void changeConnection(final PluginCall call, final String methodName) {
        final String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("No device address given.");
            return;
        }

        BluetoothAdapter adapter = adapter();
        if (adapter == null) {
            call.reject("This device has no Bluetooth adapter.");
            return;
        }
        if (!hasBtPermission()) {
            call.reject("Bluetooth permission has not been granted.");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is switched off.");
            return;
        }

        final BluetoothDevice device;
        try {
            device = adapter.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            call.reject("That isn't a device this phone knows about.");
            return;
        }

        withProfiles(adapter, new ProfilesReady() {
            @Override
            public void run(BluetoothProfile a2dp, BluetoothProfile headset) {
                boolean any = false;
                String lastError = null;

                for (BluetoothProfile proxy : new BluetoothProfile[] { a2dp, headset }) {
                    if (proxy == null || !supports(proxy, device)) continue;
                    try {
                        Method method = proxy.getClass().getMethod(methodName, BluetoothDevice.class);
                        method.setAccessible(true);
                        Object outcome = method.invoke(proxy, device);
                        if (Boolean.TRUE.equals(outcome)) any = true;
                    } catch (NoSuchMethodException e) {
                        // The hidden method is gone on this Android version.
                        // Reported, never thrown — see the class comment.
                        lastError = "This version of Android doesn't allow that.";
                    } catch (Exception e) {
                        lastError = e.getMessage();
                    }
                }

                JSObject result = new JSObject();
                result.put("ok", any);
                if (!any) {
                    result.put(
                        "error",
                        lastError != null ? lastError : "Nothing responded — try again in a moment."
                    );
                }
                call.resolve(result);
            }
        });
    }

    // --- profile proxies ----------------------------------------------------

    private interface ProfilesReady {
        void run(BluetoothProfile a2dp, BluetoothProfile headset);
    }

    /**
     * Open both profile proxies, then hand them over.
     *
     * {@code getProfileProxy} is asynchronous and gives no combined callback,
     * so the two arrivals are counted and the body runs once on the second.
     * Both proxies are closed immediately afterwards: they hold a binding to a
     * system service, and leaking one per screen refresh eventually exhausts
     * the per-app limit and makes every later request fail silently.
     */
    private void withProfiles(final BluetoothAdapter adapter, final ProfilesReady ready) {
        final BluetoothProfile[] proxies = new BluetoothProfile[2];
        final boolean[] arrived = new boolean[2];
        final boolean[] fired = new boolean[1];

        BluetoothProfile.ServiceListener listener = new BluetoothProfile.ServiceListener() {
            @Override
            public void onServiceConnected(int profile, BluetoothProfile proxy) {
                store(profile, proxy);
            }

            @Override
            public void onServiceDisconnected(int profile) {
                store(profile, null);
            }

            private void store(int profile, BluetoothProfile proxy) {
                int index = profile == BluetoothProfile.A2DP ? 0 : 1;
                synchronized (arrived) {
                    proxies[index] = proxy;
                    arrived[index] = true;
                    if (!arrived[0] || !arrived[1] || fired[0]) return;
                    fired[0] = true;
                }

                try {
                    ready.run(proxies[0], proxies[1]);
                } finally {
                    for (int i = 0; i < proxies.length; i++) {
                        if (proxies[i] != null) {
                            adapter.closeProfileProxy(
                                i == 0 ? BluetoothProfile.A2DP : BluetoothProfile.HEADSET,
                                proxies[i]
                            );
                        }
                    }
                }
            }
        };

        for (int profile : PROFILES) {
            if (!adapter.getProfileProxy(getContext(), listener, profile)) {
                // The proxy will never arrive for this profile, so mark it done
                // now — otherwise the callback above waits for a second that is
                // never coming and the call hangs unresolved forever.
                listener.onServiceDisconnected(profile);
            }
        }
    }

    private static void collectConnected(BluetoothProfile proxy, Set<String> into) {
        if (proxy == null) return;
        try {
            for (BluetoothDevice device : proxy.getConnectedDevices()) {
                into.add(device.getAddress());
            }
        } catch (SecurityException ignored) {
            // Permission was revoked between the check and here. An incomplete
            // list is better than failing the whole screen.
        }
    }

    /** Whether a profile knows this device at all — i.e. it's worth calling. */
    private static boolean supports(BluetoothProfile proxy, BluetoothDevice device) {
        if (proxy == null) return false;
        try {
            int state = proxy.getConnectionState(device);
            // Any state other than "no idea" means the profile recognises it.
            if (state != BluetoothProfile.STATE_DISCONNECTED) return true;
        } catch (SecurityException ignored) {
            return false;
        }

        // A disconnected device reports STATE_DISCONNECTED whether the profile
        // applies to it or not, so fall back to the device's own class — which
        // is what says "this is an audio thing" regardless of current state.
        return isAudioDevice(device);
    }

    private static boolean isAudioDevice(BluetoothDevice device) {
        BluetoothClass klass;
        try {
            klass = device.getBluetoothClass();
        } catch (SecurityException e) {
            return false;
        }
        if (klass == null) return false;
        return klass.hasService(BluetoothClass.Service.AUDIO)
            || klass.getMajorDeviceClass() == BluetoothClass.Device.Major.AUDIO_VIDEO;
    }

    /** A rough kind, only ever used to pick the row's icon. */
    private static String classify(BluetoothDevice device) {
        BluetoothClass klass;
        try {
            klass = device.getBluetoothClass();
        } catch (SecurityException e) {
            return "other";
        }
        if (klass == null) return "other";

        switch (klass.getDeviceClass()) {
            case BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO:
            case BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE:
                return "car";
            case BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES:
            case BluetoothClass.Device.AUDIO_VIDEO_WEARABLE_HEADSET:
                return "headphones";
            case BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER:
            case BluetoothClass.Device.AUDIO_VIDEO_HIFI_AUDIO:
            case BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO:
                return "speaker";
            case BluetoothClass.Device.PHONE_SMART:
                return "phone";
            case BluetoothClass.Device.WEARABLE_WRIST_WATCH:
                return "watch";
            default:
                return klass.getMajorDeviceClass() == BluetoothClass.Device.Major.AUDIO_VIDEO
                    ? "speaker"
                    : "other";
        }
    }
}
