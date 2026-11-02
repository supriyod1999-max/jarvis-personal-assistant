package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class WindowsApprovalTimingTest {
    @Test public void freshClockSkewDoesNotRejectNewRequests() {
        assertTrue(WindowsApprovalTiming.fresh(120027, 0, true));
        assertTrue(WindowsApprovalTiming.fresh(30027, 0, false));
        assertTrue(WindowsApprovalTiming.fresh(301000, 0, true));
        assertFalse(WindowsApprovalTiming.fresh(301001, 0, true));
        assertFalse(WindowsApprovalTiming.fresh(31001, 0, false));
    }
    @Test public void expiryAndOverflowNeverBecomeValid() {
        assertFalse(WindowsApprovalTiming.fresh(1000, 1000, true));
        assertFalse(WindowsApprovalTiming.fresh(999, 1000, false));
        assertFalse(WindowsApprovalTiming.fresh(Long.MAX_VALUE, -1, false));
    }
}
