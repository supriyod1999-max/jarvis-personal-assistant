"""Private, persistent Chatterbox worker. JSON lines in; watermarked WAV out."""
import base64
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
os.environ['HF_HOME'] = str(ROOT / 'data' / 'voice-models')
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DOWNLOAD_TIMEOUT'] = '120'
os.environ['HF_HUB_DISABLE_SYMLINKS_WARNING'] = '1'
os.environ['DO_NOT_TRACK'] = '1'
protocol = sys.stdout
parser = argparse.ArgumentParser()
parser.add_argument('--reference')
parser.add_argument('--check')
args = parser.parse_args()

def emit(value):
    protocol.write(json.dumps(value) + '\n')
    protocol.flush()

try:
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import soundfile as sf
        from huggingface_hub import snapshot_download
        from chatterbox.tts_turbo import ChatterboxTurboTTS
        if not torch.cuda.is_available():
            raise RuntimeError('GPU unavailable')
        torch.set_num_threads(4)
        revision = '749d1c1a46eb10492095d68fbcf55691ccf137cd'
        model_path = ROOT / 'data' / 'voice-models' / 'hub' / 'models--ResembleAI--chatterbox-turbo' / 'snapshots' / revision
        required = ['ve.safetensors', 't3_turbo_v1.safetensors', 's3gen_meanflow.safetensors', 'conds.pt', 'tokenizer_config.json', 'vocab.json', 'merges.txt']
        if not all((model_path / name).is_file() for name in required):
            model_path = snapshot_download(
                repo_id='ResembleAI/chatterbox-turbo', revision=revision,
                allow_patterns=required + ['*.json', '*.txt'],
                local_files_only='--check' not in sys.argv, token=False,
            )
        model = ChatterboxTurboTTS.from_local(model_path, device='cuda')
        if model.conds is None:
            raise RuntimeError('Built-in voice unavailable')
        if args.reference:
            ref_path = Path(args.reference).resolve()
            info = sf.info(ref_path)
            if not 5 < info.duration <= 30 or info.channels != 1 or info.samplerate != 24000:
                raise ValueError('Use a mono 24 kHz reference between 5 and 30 seconds')
            # Prepare once per worker; never repeat reference encoding per sentence.
            model.prepare_conditionals(str(ref_path))
except Exception as error:
    print('Voice initialization failed: ' + type(error).__name__, file=sys.stderr)
    if '--check' in sys.argv:
        import traceback
        traceback.print_exc(file=sys.stderr)
    emit({'type': 'error', 'error': 'Chatterbox could not load on the GPU. Check the local voice installation.'})
    sys.exit(1)

def generate(text):
    started = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
        wav = model.generate(text).squeeze().detach().cpu().numpy()
        target = io.BytesIO()
        sf.write(target, wav, model.sr, format='WAV', subtype='PCM_16')
    return target.getvalue(), round(time.perf_counter() - started, 3), len(wav) / model.sr

# Model loading alone leaves first-use CUDA/kernel work on the first real reply.
# Prime once before reporting ready, discard the sample, and never play it.
try:
    generate('Ready when you are.')
    emit({'type': 'ready', 'engine': 'Chatterbox Turbo', 'device': 'cuda', 'sampleRate': model.sr})
except Exception as error:
    print('Voice preparation failed: ' + type(error).__name__, file=sys.stderr)
    emit({'type': 'error', 'error': 'Chatterbox could not prepare speech on the GPU. Please try again.'})
    sys.exit(1)

if args.check:
    for number, text in enumerate(['Good morning, sir. What shall we work on today?', 'Of course, sir. Your notes are ready whenever you need them.']):
        wav, elapsed, duration = generate(text)
        if number == 0:
            Path(args.check).write_bytes(wav)
        emit({'type': 'check', 'seconds': elapsed, 'audioSeconds': round(duration, 3), 'bytes': len(wav), 'gpuMemoryMiB': round(torch.cuda.max_memory_allocated() / 1024 ** 2)})
    sys.exit(0)

for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        text = request.get('text', '')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 600:
            raise ValueError('Invalid speech text')
        wav, elapsed, duration = generate(text)
        emit({'type': 'audio', 'id': request['id'], 'wav': base64.b64encode(wav).decode('ascii'), 'seconds': elapsed})
    except Exception as error:
        print('Voice generation failed: ' + type(error).__name__, file=sys.stderr)
        emit({'type': 'error', 'id': request.get('id') if isinstance(request, dict) else None, 'error': 'Chatterbox could not finish this reply. Please try again.'})
