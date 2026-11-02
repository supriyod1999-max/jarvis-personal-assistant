"""Persistent local Kokoro Daniel worker. Explicit CPU/CUDA; no downloads or credentials."""
import argparse
import base64
import contextlib
import ctypes
import hashlib
import io
import importlib.metadata
import importlib.util
import json
import os
import re
from pathlib import Path, PurePosixPath
import sys
import time
import unicodedata
import wave

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'data' / 'voice-models' / 'kokoro'
MODEL = ASSETS / 'kokoro-int8-multi-lang-v1_0'
ARCHIVE_SHA = '4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e'
MAX_SAMPLES = 24000 * 90
protocol = sys.stdout
parser = argparse.ArgumentParser()
parser.add_argument('--check', help='Save a synthetic local check WAV and exit')
parser.add_argument('--threads', type=int, choices=[1, 2, 4, 6, 8], default=6)
parser.add_argument('--provider', choices=['cpu', 'cuda'], default='cpu')
args = parser.parse_args()

def emit(value):
    protocol.write(json.dumps(value) + '\n')
    protocol.flush()

def verify_assets():
    manifest = json.loads((ASSETS / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('archiveSha256') != ARCHIVE_SHA or manifest.get('voice') != 'bm_daniel' or manifest.get('speakerId') != 24:
        raise ValueError('Unexpected Kokoro model or voice')
    files = manifest.get('files', {})
    required = ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-gb-en.txt']
    if not all('kokoro-int8-multi-lang-v1_0/' + name in files for name in required):
        raise ValueError('Kokoro model manifest is incomplete')
    for relative, expected in files.items():
        path = PurePosixPath(relative)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != MODEL.name:
            raise ValueError('Invalid asset path')
        target = ASSETS.joinpath(*path.parts)
        if target.is_symlink() or not target.is_file() or target.stat().st_size != expected['bytes']:
            raise ValueError('Kokoro asset changed')
        with target.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected['sha256']:
                raise ValueError('Kokoro asset checksum mismatch')

def generate(text, voice="bm_daniel", speed=1.0, style="natural"):
    speakers = {"bm_daniel": 24, "af_heart": 3, "af_bella": 2, "am_puck": 18}
    if voice not in speakers or style not in ("natural", "pet") or not isinstance(speed, (int, float)) or not .9 <= speed <= 1.12:
        raise ValueError("Unsupported pet voice")
    sid = speakers[voice]
    started = time.perf_counter()
    observed = 0
    exceeded = False
    def bounded(samples, progress):
        nonlocal observed, exceeded
        observed += len(samples)
        exceeded = observed > MAX_SAMPLES
        # The pinned C++ implementation uses 1 to continue and 0 to stop.
        return 0 if exceeded else 1
    with contextlib.redirect_stdout(sys.stderr):
        if args.provider == 'cuda':
            generation = sherpa_onnx.GenerationConfig()
            generation.sid = sid
            generation.speed = speed
            espeak_bridge.set_voice("en-us" if voice.startswith("a") else "en")
            generation.phoneme_codepoints = phonemize(text)
            audio = tts.generate(text, generation, callback=bounded)
        else:
            audio = tts.generate(text, sid=sid, speed=speed, callback=bounded)
    samples = np.asarray(audio.samples, dtype=np.float32)
    if exceeded or not 0 < len(samples) <= MAX_SAMPLES or not np.isfinite(samples).all():
        raise ValueError('Generated audio exceeded its bounds or was invalid')
    if style == "pet":
        # Request-scoped bright robot character. No second model or saved default change.
        positions = np.arange(0, len(samples) - 1, 1.12)
        samples = np.interp(positions, np.arange(len(samples)), samples).astype(np.float32)
        seconds = np.arange(len(samples), dtype=np.float32) / audio.sample_rate
        samples *= .96 + .04 * np.sin(2 * np.pi * 35 * seconds)
    target = io.BytesIO()
    with wave.open(target, 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(audio.sample_rate)
        output.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
    return target.getvalue(), round(time.perf_counter() - started, 3), len(samples) / audio.sample_rate

def phonemize(text):
    # Piper's pinned native eSpeak bridge handles names and numbers locally.
    # Load only the extension, without importing Piper's separate ONNX TTS engine.
    sentences, sentence = [], []
    for phones, terminator, end_of_sentence in espeak_bridge.get_phonemes(text):
        phones = re.sub(r'\([^)]+\)', '', phones) + terminator
        if terminator in (',', ':', ';'):
            phones += ' '
        sentence.extend(ord(c) for c in unicodedata.normalize('NFD', phones))
        if end_of_sentence and sentence:
            sentences.append(sentence)
            sentence = []
    if sentence:
        sentences.append(sentence)
    if not sentences:
        raise ValueError('Local pronunciation could not be prepared')
    return sentences

try:
    os.environ['OMP_NUM_THREADS'] = str(args.threads)
    dll_directories = []
    cuda_runtime = None
    gpu_free_before = None
    if args.provider == 'cuda' and os.name == 'nt':
        # Reuse existing app-local CUDA/cuDNN DLLs read-only. No driver/global PATH changes.
        dll_root = ROOT / 'integrations/chatterbox/.venv/Lib/site-packages/torch/lib'
        if not all((dll_root / name).is_file() for name in ['cudart64_12.dll', 'cudnn64_9.dll', 'cublas64_12.dll']):
            raise ValueError('Existing local CUDA/cuDNN runtime is unavailable')
        dll_directories.append(os.add_dll_directory(str(dll_root)))
        # ONNX Runtime also uses legacy LoadLibrary for provider dependencies.
        # This PATH exists only in this isolated worker process.
        os.environ['PATH'] = str(dll_root) + os.pathsep + os.environ.get('PATH', '')
        cuda_libraries = [ctypes.WinDLL(str(dll_root / name)) for name in ['cublasLt64_12.dll', 'cublas64_12.dll', 'cudnn64_9.dll']]
        cuda_runtime = ctypes.WinDLL(str(dll_root / 'cudart64_12.dll'))
        devices = ctypes.c_int()
        if cuda_runtime.cudaGetDeviceCount(ctypes.byref(devices)) != 0 or devices.value < 1:
            raise ValueError('CUDA device unavailable')
        free_bytes, total_bytes = ctypes.c_size_t(), ctypes.c_size_t()
        if cuda_runtime.cudaMemGetInfo(ctypes.byref(free_bytes), ctypes.byref(total_bytes)) != 0:
            raise ValueError('CUDA memory query failed')
        gpu_free_before = free_bytes.value
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import sherpa_onnx
        expected_version = '1.13.8+cuda12.cudnn9' if args.provider == 'cuda' else '1.13.8'
        if sherpa_onnx.__version__ != expected_version:
            raise ValueError('Unexpected Kokoro runtime version')
        verify_assets()
        model_file = MODEL / 'model.int8.onnx'
        if args.provider == 'cuda':
            if importlib.metadata.version('piper-tts') != '1.8.0':
                raise ValueError('Unexpected local phonemizer version')
            piper_root = Path(sys.prefix) / 'Lib/site-packages/piper'
            bridge_spec = importlib.util.spec_from_file_location('espeakbridge', piper_root / 'espeakbridge.pyd')
            espeak_bridge = importlib.util.module_from_spec(bridge_spec)
            bridge_spec.loader.exec_module(espeak_bridge)
            espeak_bridge.initialize(str(piper_root / 'espeak-ng-data'))
            espeak_bridge.set_voice('en')
            model_file = ROOT / 'data/voice-models/kokoro-gpu/model.onnx'
            with model_file.open('rb') as model_stream:
                if hashlib.file_digest(model_stream, 'sha256').hexdigest() != 'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11':
                    raise ValueError('Pinned GPU model checksum mismatch')
        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                    model=str(model_file), voices=str(MODEL / 'voices.bin'),
                    tokens=str(MODEL / 'tokens.txt'), data_dir=str(MODEL / 'espeak-ng-data') if args.provider == 'cpu' else '',
                    lexicon=str(MODEL / 'lexicon-gb-en.txt'), lang='en' if args.provider == 'cpu' else ''),
                provider=args.provider, num_threads=args.threads, debug=False),
            max_num_sentences=1)
        if not config.validate():
            raise ValueError('Invalid local Kokoro configuration')
        tts = sherpa_onnx.OfflineTts(config)
        if tts.sample_rate != 24000 or tts.num_speakers < 25:
            raise ValueError('Unexpected Kokoro speaker model')
        generate('Ready when you are.')
        gpu_memory_mib = None
        if args.provider == 'cuda':
            if cuda_runtime is None or cuda_runtime.cudaDeviceSynchronize() != 0:
                raise ValueError('CUDA speech initialization failed')
            free_bytes, total_bytes = ctypes.c_size_t(), ctypes.c_size_t()
            if cuda_runtime.cudaMemGetInfo(ctypes.byref(free_bytes), ctypes.byref(total_bytes)) != 0:
                raise ValueError('CUDA memory query failed')
            gpu_memory_mib = round((gpu_free_before - free_bytes.value) / 1024 ** 2, 1)
            if gpu_memory_mib < 16:
                raise ValueError('CUDA model allocation was not confirmed')
    ready = {'type': 'ready', 'engine': 'Kokoro 82M', 'voice': 'bm_daniel', 'device': args.provider, 'sampleRate': 24000}
    if gpu_memory_mib is not None:
        ready['gpuMemoryDeltaMiB'] = gpu_memory_mib
    emit(ready)
except Exception as error:
    print('Kokoro initialization failed: ' + type(error).__name__, file=sys.stderr)
    if args.check:
        import traceback
        traceback.print_exc(file=sys.stderr)
    emit({'type': 'error', 'error': 'Local Kokoro Daniel could not load. Check the voice installation.'})
    sys.exit(1)

if args.check:
    wav, elapsed, duration = generate('Good morning, sir. I am ready to help. What would you like to do today?')
    Path(args.check).write_bytes(wav)
    emit({'type': 'check', 'seconds': elapsed, 'audioSeconds': round(duration, 3), 'bytes': len(wav), 'device': args.provider, 'voice': 'bm_daniel'})
    sys.exit(0)

for line in sys.stdin:
    request = None
    try:
        if len(line) > 10000:
            raise ValueError('Voice request exceeded its limit')
        request = json.loads(line)
        text = request.get('text', '')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600 or not isinstance(request.get('id'), str):
            raise ValueError('Invalid speech request')
        wav, elapsed, duration = generate(text.strip(), request.get("voice", "bm_daniel"), request.get("speed", 1.0), request.get("style", "natural"))
        emit({'type': 'audio', 'id': request['id'], 'wav': base64.b64encode(wav).decode('ascii'), 'seconds': elapsed})
    except Exception as error:
        print('Kokoro generation failed: ' + type(error).__name__, file=sys.stderr)
        emit({'type': 'error', 'id': request.get('id') if isinstance(request, dict) else None, 'error': 'Local Kokoro speech could not finish this reply.'})
