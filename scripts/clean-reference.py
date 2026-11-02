"""Separate a user-supplied local clip. Keeps source and model files in the workspace."""
import os
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'integrations/audio-tools'))
os.environ['TORCH_HOME'] = str(ROOT / 'data/audio-models')
import soundfile as sf
import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model
torch.set_num_threads(4)
source = ROOT / 'output/voice/reference-original.wav'
wave, rate = sf.read(source, dtype='float32', always_2d=True)
model = get_model('htdemucs').eval()
assert rate == model.samplerate
x = torch.from_numpy(wave.T.copy())
reference = x.mean(0)
mean, std = reference.mean(), reference.std()
x = (x - mean) / std.clamp(min=1e-6)
# CPU leaves the app's GPU available for conversations while this one-off job runs.
with torch.inference_mode():
    stems = apply_model(model, x[None], device='cpu', shifts=1, split=True, overlap=.25, progress=True)[0]
    stems = stems * std + mean
vocals = stems[model.sources.index('vocals')].T.numpy()
sf.write(ROOT / 'output/voice/reference-vocals.wav', vocals, rate, subtype='PCM_16')
print('Separated vocals written.', flush=True)
