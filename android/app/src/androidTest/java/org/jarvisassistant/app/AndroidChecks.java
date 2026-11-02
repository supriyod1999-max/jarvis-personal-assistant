package org.jarvisassistant.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.view.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** All native HTTP is replaced in the instrumentation process. No real user accounts. */
public class AndroidChecks {
    static final String HOST = "https://fixture.tail-test.ts.net";
    static final List<FakeConnection> calls = Collections.synchronizedList(new ArrayList<>());
    static final AtomicBoolean unlocked = new AtomicBoolean(true);
    static class FakeConnection extends HttpURLConnection {
        final ByteArrayOutputStream body = new ByteArrayOutputStream();
        FakeConnection(URL url) { super(url); calls.add(this); }
        @Override public void connect() {}
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public OutputStream getOutputStream() { return body; }
        @Override public int getResponseCode() { return url.getPath().endsWith("failure") ? 503 : url.getPath().endsWith("redirect") ? 302 : 200; }
        @Override public InputStream getInputStream() {
            String path = url.getPath(), value = "{}";
            if (path.endsWith("status")) value = "{\"enabled\":true,\"unlocked\":" + unlocked.get() + "}";
            if (path.endsWith("health")) value = "{\"serverId\":\"00000000-0000-4000-8000-000000000001\"}";
            if (path.equals("/api/chat/status")) value = "{\"state\":\"ready\",\"provider\":\"chatgpt-direct\"}";
            if (path.endsWith("events")) value = ": keepalive\n\ndata: {\"turns\":[{\"reply\":\"Synthetic reply\",\"status\":\"complete\"}]}\n\n";
            return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
        }
    }
    @BeforeClass public static void fixture() {
        URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL u) { if (!u.getHost().equals("fixture.tail-test.ts.net")) throw new AssertionError("Unexpected host in native test"); return new FakeConnection(u); }
        } : null);
    }
    @Before public void before() {
        calls.clear(); unlocked.set(true);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.stopService(new Intent(context, VoiceService.class));
        context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).edit().clear().commit();
    }
    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor fd = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command); InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) { while (in.read() != -1) {} }
    }
    private void waitFor(java.util.function.BooleanSupplier condition, long timeout) throws Exception {
        long end = SystemClock.elapsedRealtime() + timeout;
        while (!condition.getAsBoolean() && SystemClock.elapsedRealtime() < end) Thread.sleep(50);
        assertTrue(condition.getAsBoolean());
    }
    private void screenshot(View view, String name) {
        try {
            Bitmap bitmap = Bitmap.createBitmap(view.getWidth(), view.getHeight(), Bitmap.Config.ARGB_8888); view.draw(new Canvas(bitmap));
            File folder = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getExternalFilesDir(null), "verification"); folder.mkdirs();
            try (OutputStream out = new FileOutputStream(new File(folder, name))) { bitmap.compress(Bitmap.CompressFormat.PNG, 100, out); } bitmap.recycle();
        } catch (Exception e) { throw new AssertionError(e); }
    }
    @Test public void a_nativeClientKeepsOriginCookieAndNeverRetriesPosts() throws Exception {
        try (ApiClient api = new ApiClient(HOST + ":8443", "jarvis_session_fixture=synthetic")) {
            api.json("/api/chat/send", new JSONObject().put("message", "Synthetic text"));
            FakeConnection sent = calls.get(0);
            assertEquals(HOST + ":8443", sent.getRequestProperty("Origin")); assertEquals("1", sent.getRequestProperty("X-Second-Brain"));
            assertEquals("jarvis_session_fixture=synthetic", sent.getRequestProperty("Cookie")); assertFalse(sent.getInstanceFollowRedirects());
            assertEquals("Synthetic text", new JSONObject(sent.body.toString("UTF-8")).getString("message"));
            int before = calls.size();
            try { api.json("/api/failure", new JSONObject()); fail(); } catch (IOException expected) {}
            assertEquals(before + 1, calls.size());
            try { api.json("/api/redirect", new JSONObject()); fail(); } catch (IOException expected) {}
            assertEquals(before + 2, calls.size());
        }
    }
    @Test public void b_nativeEventsReadOneSnapshotAndCloseCleanly() throws Exception {
        ApiClient api = new ApiClient(HOST, ""); AtomicBoolean sawReply = new AtomicBoolean();
        api.events("00000000-0000-4000-8000-000000000002", snapshot -> { sawReply.set(snapshot.getJSONArray("turns").getJSONObject(0).getString("reply").equals("Synthetic reply")); return true; });
        assertTrue(sawReply.get()); api.close(); int count = calls.size();
        try { api.json("/api/health", null); fail(); } catch (IOException expected) {}
        assertEquals(count, calls.size());
    }
    @Test public void c_onboardingDoesNotStartMicrophoneAndOverlayHasRealControls() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            Thread.sleep(500); assertFalse(VoiceService.running);
            scenario.onActivity(activity -> screenshot(activity.getWindow().getDecorView(), "onboarding.png"));
            shell("appops set org.jarvisassistant.app SYSTEM_ALERT_WINDOW allow");
            final FloatingOrb[] orb = new FloatingOrb[1];
            scenario.onActivity(activity -> { orb[0] = new FloatingOrb(activity, () -> {}, () -> {}, () -> {}); orb[0].show(); });
            Thread.sleep(400);
            scenario.onActivity(activity -> {
                try { java.lang.reflect.Field f = FloatingOrb.class.getDeclaredField("root"); f.setAccessible(true); screenshot((View)f.get(orb[0]), "orb-compact.png"); } catch (Exception e) { throw new AssertionError(e); }
                orb[0].update("Listening", "What would you like to do?", true, .6f);
            });
            Thread.sleep(450);
            scenario.onActivity(activity -> {
                try { java.lang.reflect.Field f = FloatingOrb.class.getDeclaredField("root"); f.setAccessible(true); View root = (View)f.get(orb[0]); assertTrue(root.getWidth() > activity.getResources().getDisplayMetrics().density * 300); screenshot(root, "orb-expanded.png"); } catch (Exception e) { throw new AssertionError(e); }
                orb[0].close();
            });
        }
    }
    @Test public void d_foregroundVoiceStopsWhenWorkspaceIsRevoked() throws Exception {
        shell("pm grant org.jarvisassistant.app android.permission.RECORD_AUDIO"); shell("pm grant org.jarvisassistant.app android.permission.POST_NOTIFICATIONS"); shell("appops set org.jarvisassistant.app SYSTEM_ALERT_WINDOW allow");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.startForegroundService(new Intent(activity, VoiceService.class).putExtra("origin", HOST).putExtra("cookie", "synthetic")));
            waitFor(() -> VoiceService.running && VoiceService.currentStatus.equals("Wake listening"), 10000);
            assertEquals(0, calls.stream().filter(c -> c.getURL().getPath().equals("/api/chat/send")).count());
            unlocked.set(false);
            waitFor(() -> !VoiceService.running, 22000);
            assertTrue(VoiceService.currentStatus.contains("locked"));
        }
    }
    @Test public void e_startingWithLockedWorkspaceDoesNotCaptureOrSend() throws Exception {
        shell("pm grant org.jarvisassistant.app android.permission.RECORD_AUDIO"); shell("appops set org.jarvisassistant.app SYSTEM_ALERT_WINDOW allow"); unlocked.set(false);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.startForegroundService(new Intent(activity, VoiceService.class).putExtra("origin", HOST)));
            waitFor(() -> VoiceService.currentStatus.contains("unlock this workspace"), 10000);
            waitFor(() -> !VoiceService.running, 3000);
            assertEquals(0, calls.stream().filter(c -> c.getURL().getPath().contains("voice/") || c.getURL().getPath().contains("chat/")).count());
        }
    }
    @Test public void f_homeKeepsListeningButScreenLockStopsIt() throws Exception {
        shell("pm grant org.jarvisassistant.app android.permission.RECORD_AUDIO"); shell("appops set org.jarvisassistant.app SYSTEM_ALERT_WINDOW allow");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.startForegroundService(new Intent(activity, VoiceService.class).putExtra("origin", HOST)));
            waitFor(() -> VoiceService.running && VoiceService.currentStatus.equals("Wake listening"), 10000);
            shell("input keyevent 3"); Thread.sleep(800); assertTrue(VoiceService.running);
            shell("input keyevent 223"); waitFor(() -> !VoiceService.running, 5000);
            assertTrue(VoiceService.currentStatus.contains("locked"));
        } finally { shell("input keyevent 224"); shell("wm dismiss-keyguard"); }
    }
    @Test public void g_notificationStopReleasesTheService() throws Exception {
        shell("pm grant org.jarvisassistant.app android.permission.RECORD_AUDIO"); shell("appops set org.jarvisassistant.app SYSTEM_ALERT_WINDOW allow");
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> activity.startForegroundService(new Intent(activity, VoiceService.class).putExtra("origin", HOST)));
            waitFor(() -> VoiceService.running && VoiceService.currentStatus.equals("Wake listening"), 10000);
            Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            assertEquals(1, notifications.getActiveNotifications().length);
            notifications.getActiveNotifications()[0].getNotification().actions[0].actionIntent.send();
            waitFor(() -> !VoiceService.running, 5000); assertEquals(0, notifications.getActiveNotifications().length);
        }
    }
    @After public void cleanup() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext(); context.stopService(new Intent(context, VoiceService.class));
        waitFor(() -> !VoiceService.running, 3000);
    }
}
