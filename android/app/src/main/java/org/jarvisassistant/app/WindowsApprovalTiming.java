package org.jarvisassistant.app;
/** A tiny future-clock allowance for the phone's sanity check only. The laptop
 * and native provider still enforce their original absolute expiry exactly. */
public final class WindowsApprovalTiming {
    private WindowsApprovalTiming() {}
    public static boolean fresh(long expiresAt, long phoneNow, boolean pairing) {
        try { long remaining = Math.subtractExact(expiresAt, phoneNow); return remaining > 0 && remaining <= (pairing ? 300000L : 30000L) + 1000L; }
        catch (ArithmeticException error) { return false; }
    }
}
