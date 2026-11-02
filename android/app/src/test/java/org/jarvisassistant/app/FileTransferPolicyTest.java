package org.jarvisassistant.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class FileTransferPolicyTest {
    @Test public void twentyGigabyteProgressDoesNotOverflow(){
        assertEquals(21474836480L,FileTransferPolicy.MAXIMUM_BYTES);
        assertEquals(50,FileTransferPolicy.progress(10L*1024*1024*1024,FileTransferPolicy.MAXIMUM_BYTES));
        assertEquals(100,FileTransferPolicy.progress(FileTransferPolicy.MAXIMUM_BYTES,FileTransferPolicy.MAXIMUM_BYTES));
    }
}
