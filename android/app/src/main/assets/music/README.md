# Local music reactions

YAMNet float32 v1, from Google's MediaPipe model distribution:
https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite

SHA-256: 4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf
Upstream model/code: https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
License: Apache 2.0. See LICENSE.txt.
Class 132 is Music; class 0 is Speech. Only the music score is used.

The existing pet wake microphone supplies 975 ms of RAM-only PCM about once per
second, only while waiting for a wake phrase. Two confident classifications start
the dance; silence/negative results settle it. This is music classification, not
song identification or exact beat tracking. No audio is saved or uploaded by this
component. It stops with pet mode, microphone pause, or disabling music reactions.
