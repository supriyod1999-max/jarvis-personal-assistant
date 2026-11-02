package org.jarvisassistant.app;
import android.content.Context;
import org.tensorflow.lite.Interpreter;
import java.nio.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Bundled YAMNet, sharing the existing wake microphone. No audio leaves this class. */
final class PetMusic implements AutoCloseable {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();private final AtomicBoolean busy=new AtomicBoolean();private final float[] ring=new float[15600];private int at,filled,since;private volatile boolean closed;private Interpreter model;private final Consumer<Float> result;private final Runnable failure;
    PetMusic(Context context,Consumer<Float> result,Runnable failure){this.result=result;this.failure=failure;worker.execute(()->{try(InputStream input=context.getAssets().open("music/yamnet.tflite")){ByteArrayOutputStream loaded=new ByteArrayOutputStream();byte[] block=new byte[16384];int n;while((n=input.read(block))!=-1){loaded.write(block,0,n);if(loaded.size()>20000000)throw new IOException("Music asset too large");}byte[] bytes=loaded.toByteArray();ByteBuffer buffer=ByteBuffer.allocateDirect(bytes.length).order(ByteOrder.nativeOrder());buffer.put(bytes).rewind();model=new Interpreter(buffer,new Interpreter.Options().setNumThreads(1));if(model.getInputTensor(0).numElements()!=15600||model.getOutputTensor(0).numElements()!=521)throw new IOException("Unexpected audio model");}catch(Exception|LinkageError error){if(model!=null){model.close();model=null;}if(!closed)failure.run();}});}
    synchronized void accept(short[] samples,int count){if(closed)return;for(int i=0;i<count;i++){ring[at]=samples[i]/32768f;at=(at+1)%ring.length;filled=Math.min(ring.length,filled+1);}since+=count;if(filled<ring.length||since<16000||!busy.compareAndSet(false,true))return;since=0;float[] frame=new float[ring.length];for(int i=0;i<frame.length;i++)frame[i]=ring[(at+i)%ring.length];worker.execute(()->{try{if(!closed&&model!=null){ByteBuffer input=ByteBuffer.allocateDirect(15600*4).order(ByteOrder.nativeOrder());for(float value:frame)input.putFloat(value);input.rewind();ByteBuffer output=ByteBuffer.allocateDirect(521*4).order(ByteOrder.nativeOrder());model.run(input,output);if(!closed)result.accept(output.getFloat(132*4));}}catch(RuntimeException error){if(!closed)failure.run();}finally{Arrays.fill(frame,0);busy.set(false);}});}
    @Override public synchronized void close(){if(closed)return;closed=true;Arrays.fill(ring,0);worker.execute(()->{if(model!=null){model.close();model=null;}});worker.shutdown();}
}
