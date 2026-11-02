package org.jarvisassistant.app;

import android.content.Context;
import android.graphics.*;
import android.provider.Settings;
import android.view.View;

/** Original, audio-reactive sphere. No WebView or screen capture in the overlay. */
public final class OrbView extends View {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private String phase = "Wake listening";
    private float level;
    private final boolean reduced;
    private Shader glow;
    private int glowColor;
    private float glowRadius, glowX, glowY;
    public OrbView(Context context) {
        super(context); setContentDescription("JARVIS voice orb");
        reduced = Settings.Global.getFloat(context.getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1) == 0;
    }
    public void state(String phase, float level) { this.phase = phase; this.level = Math.max(0, Math.min(1, level)); invalidate(); }
    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        float t = reduced ? 0 : (android.os.SystemClock.uptimeMillis() % 200000) / 1000f;
        float cx = getWidth() / 2f, cy = getHeight() / 2f;
        float r = Math.min(cx, cy) * (.64f + level * .12f);
        int color = phase.contains("Thinking") || phase.contains("Preparing") ? NativeStyle.WARNING : NativeStyle.ACCENT;
        if (glow == null || glowColor != color || glowX != cx || glowY != cy) {
            glowColor = color; glowX = cx; glowY = cy; glowRadius = Math.min(cx, cy);
            glow = new RadialGradient(cx, cy, glowRadius, new int[]{color & 0x55ffffff, 0x00102c35}, null, Shader.TileMode.CLAMP);
        }
        paint.setShader(glow);
        canvas.drawCircle(cx, cy, r * 1.5f, paint); paint.setShader(null);
        for (int row = -9; row <= 9; row++) {
            float y = row / 10f, ring = (float)Math.sqrt(1 - y*y);
            for (int j = 0; j < 34; j++) {
                double angle = j * Math.PI * 2 / 34 + t * .23 + row * .19;
                float z = (float)Math.cos(angle), x = (float)Math.sin(angle);
                float wave = 1 + .035f * (float)Math.sin(t * 2 + row + j * .5);
                paint.setColor(color); paint.setAlpha((int)(55 + (z + 1) * 85));
                canvas.drawCircle(cx + x * ring * r * wave, cy + y * r + (float)Math.sin(angle + t) * level * 5, (.6f + (z + 1) * .28f) * Math.max(.85f, r / 90f), paint);
            }
        }
        if (!reduced && isShown()) postInvalidateDelayed(33);
    }
}
