package org.jarvisassistant.app;
import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.*;
import android.os.*;
import android.util.Size;
import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.lifecycle.LifecycleOwner;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.*;
import com.google.mlkit.vision.pose.*;
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions;
import com.google.android.gms.tasks.Tasks;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/** Opt-in local face position only. No identity, saved frames or model upload. */
final class PetCamera implements AutoCloseable {
    interface Listener{void state(String status,boolean open);void face(float x,float y,int count);default void expression(float smile,float left,float right,float tilt){}default void wave(){}}
    private final Context context;private final LifecycleOwner owner;private final Listener listener;private final ExecutorService worker=Executors.newSingleThreadExecutor();private final Handler main=new Handler(Looper.getMainLooper());private final AtomicBoolean detecting=new AtomicBoolean();
    private PoseDetector poseDetector;private final PetReactions reactions=new PetReactions();private FaceDetector detector;private ProcessCameraProvider provider;private ImageAnalysis analysis;private volatile boolean closed,open,saving;private boolean front;private long last;private static final class Capture{final Consumer<byte[]> result;final Consumer<String> error;Capture(Consumer<byte[]> result,Consumer<String> error){this.result=result;this.error=error;}}private volatile Capture pending;
    PetCamera(Context context,LifecycleOwner owner,Listener listener){this.context=context;this.owner=owner;this.listener=listener;}
    void powerSaving(boolean value){saving=value;}
    void start(boolean selfie){if(closed)return;if(context.checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){listener.state("Camera off · permission not granted",false);return;}front=selfie;listener.state("Starting local tracking…",false);FaceDetectorOptions options=new FaceDetectorOptions.Builder().setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST).setMinFaceSize(.12f).setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL).enableTracking().build();detector=FaceDetection.getClient(options);poseDetector=PoseDetection.getClient(new PoseDetectorOptions.Builder().setDetectorMode(PoseDetectorOptions.STREAM_MODE).build());ListenableFuture<ProcessCameraProvider> future=ProcessCameraProvider.getInstance(context);
        future.addListener(()->{if(closed)return;try{provider=future.get();CameraSelector selector=selfie?CameraSelector.DEFAULT_FRONT_CAMERA:CameraSelector.DEFAULT_BACK_CAMERA;if(!provider.hasCamera(selector))throw new IOException("That camera is not available. Choose the other camera.");analysis=new ImageAnalysis.Builder().setTargetResolution(new Size(640,480)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();analysis.setAnalyzer(worker,this::analyze);androidx.camera.core.Camera camera=provider.bindToLifecycle(owner,selector,analysis);camera.getCameraInfo().getCameraState().observe(owner,state->{if(closed)return;open=state.getType()==CameraState.Type.OPEN;listener.state(open?"Local tracking on":"Camera paused",open);if(state.getError()!=null)listener.state("Camera unavailable · close other camera apps",false);});}catch(Exception error){listener.state(error instanceof IOException?error.getMessage():"Camera could not start. Try again from controls.",false);close();}},context.getMainExecutor());
    }
    @androidx.annotation.OptIn(markerClass=ExperimentalGetImage.class)
    private void analyze(ImageProxy image){try{if(closed){image.close();return;}Capture capture=pending;if(capture!=null){pending=null;Consumer<byte[]> callback=capture.result;Consumer<String> error=capture.error;try{Bitmap source=image.toBitmap();Matrix matrix=new Matrix();matrix.postRotate(image.getImageInfo().getRotationDegrees());if(front)matrix.postScale(-1,1);Bitmap oriented=Bitmap.createBitmap(source,0,0,source.getWidth(),source.getHeight(),matrix,true);int longest=Math.max(oriented.getWidth(),oriented.getHeight());Bitmap sized=longest>960?Bitmap.createScaledBitmap(oriented,Math.round(oriented.getWidth()*960f/longest),Math.round(oriented.getHeight()*960f/longest),true):oriented;ByteArrayOutputStream bytes=new ByteArrayOutputStream();sized.compress(Bitmap.CompressFormat.JPEG,78,bytes);byte[] frame=bytes.toByteArray();if(sized!=oriented)sized.recycle();if(oriented!=source)oriented.recycle();source.recycle();if(frame.length>512000)throw new IOException();main.post(()->{if(!closed)callback.accept(frame);else Arrays.fill(frame,(byte)0);});}catch(Exception failed){main.post(()->error.accept("A fresh image could not be captured."));}}
        long now=SystemClock.elapsedRealtime();if(now-last<(saving?700:180)||image.getImage()==null||!detecting.compareAndSet(false,true)){image.close();return;}last=now;int rotation=image.getImageInfo().getRotationDegrees(),width=rotation%180==0?image.getWidth():image.getHeight(),height=rotation%180==0?image.getHeight():image.getWidth();InputImage input=InputImage.fromMediaImage(image.getImage(),rotation);
        com.google.android.gms.tasks.Task<java.util.List<Face>> faceTask=detector.process(input);com.google.android.gms.tasks.Task<Pose> poseTask;try{poseTask=poseDetector.process(input);}catch(RuntimeException failure){poseTask=Tasks.forException(failure);}faceTask.addOnSuccessListener(context.getMainExecutor(),faces->{if(closed)return;Face largest=null;for(Face face:faces)if(largest==null||face.getBoundingBox().width()*face.getBoundingBox().height()>largest.getBoundingBox().width()*largest.getBoundingBox().height())largest=face;if(largest==null){reactions.lostFace();listener.face(0,0,0);listener.expression(-1,-1,-1,0);return;}Rect bounds=largest.getBoundingBox();float x=(bounds.exactCenterX()/width-.5f)*2,y=(bounds.exactCenterY()/height-.5f)*2;listener.face(front?-x:x,y,faces.size());listener.expression(value(largest.getSmilingProbability()),value(largest.getLeftEyeOpenProbability()),value(largest.getRightEyeOpenProbability()),front?-largest.getHeadEulerAngleZ():largest.getHeadEulerAngleZ());}).addOnFailureListener(context.getMainExecutor(),error->{if(!closed)listener.state("Tracking needs a moment · camera stays local",open);});
        poseTask.addOnSuccessListener(context.getMainExecutor(),pose->{if(closed)return;PoseLandmark ls=pose.getPoseLandmark(PoseLandmark.LEFT_SHOULDER),rs=pose.getPoseLandmark(PoseLandmark.RIGHT_SHOULDER),lw=pose.getPoseLandmark(PoseLandmark.LEFT_WRIST),rw=pose.getPoseLandmark(PoseLandmark.RIGHT_WRIST);if(ls==null||rs==null||lw==null||rw==null)return;float span=Math.abs(ls.getPosition().x-rs.getPosition().x)/width,cx=(ls.getPosition().x+rs.getPosition().x)/2/width,cy=(ls.getPosition().y+rs.getPosition().y)/2/height;if(reactions.hands(lw.getPosition().x/width,lw.getPosition().y/height,lw.getInFrameLikelihood(),rw.getPosition().x/width,rw.getPosition().y/height,rw.getInFrameLikelihood(),cx,cy,span,Math.min(ls.getInFrameLikelihood(),rs.getInFrameLikelihood()),SystemClock.elapsedRealtime())==PetReactions.Cue.WAVE)listener.wave();});
        Tasks.whenAllComplete(faceTask,poseTask).addOnCompleteListener(task->{detecting.set(false);image.close();});
        }catch(RuntimeException failure){detecting.set(false);image.close();main.post(()->{if(!closed)listener.state("Tracking paused · retry from Pet controls",open);});}
    }
    private static float value(Float v){return v==null?-1:v;}
    void snapshot(Consumer<byte[]> result,Consumer<String> error){if(closed||!open){error.accept("Camera sharing is off on this device.");return;}if(pending!=null){error.accept("A camera check-in is already pending.");return;}Capture capture=new Capture(result,error);pending=capture;main.postDelayed(()->{if(pending==capture){pending=null;error.accept("No fresh camera frame arrived. Try again.");}},5000);}
    @Override public void close(){if(closed)return;closed=true;open=false;main.removeCallbacksAndMessages(null);Capture capture=pending;pending=null;if(capture!=null)capture.error.accept("Camera session ended.");if(analysis!=null){analysis.clearAnalyzer();if(provider!=null)provider.unbind(analysis);}if(detector!=null)detector.close();if(poseDetector!=null)poseDetector.close();worker.shutdownNow();listener.face(0,0,0);}
}
