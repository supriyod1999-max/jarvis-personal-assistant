package org.jarvisassistant.app;

/** Keep large byte counts in longs; a 20 GB transfer exceeds signed 32-bit sizes. */
final class FileTransferPolicy {
    static final long MAXIMUM_BYTES=20L*1024*1024*1024;
    static int progress(long received,long total){return total>0?(int)Math.min(100,received*100/total):0;}
}
