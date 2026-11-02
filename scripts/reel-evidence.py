"""Bounded local audio/frame extraction from an already verified reel receipt."""
import base64
import json
import struct
import subprocess
import sys
from pathlib import Path
from reel_library import ReelLibrary

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'integrations/audio-tools'))

def main():
    import imageio_ffmpeg
    directory, code = Path(sys.argv[1]), sys.argv[2]
    import re
    if not re.fullmatch(r'[A-Za-z0-9_-]{5,32}', code):
        raise ValueError('Invalid reel identity')
    with ReelLibrary(directory) as library:
        receipt = library.cached(code)
    if not receipt:
        raise ValueError('Verified media receipt is missing or the file changed')
    duration = float(receipt['durationSeconds'])
    if not 0.35 <= duration <= 300:
        raise ValueError('Automatic understanding currently supports reels up to five minutes')
    ffmpeg, media = imageio_ffmpeg.get_ffmpeg_exe(), str(directory / receipt['file'])
    def extract(args):
        result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', *args], capture_output=True, timeout=45)
        if result.returncode:
            raise ValueError('Local media extraction failed')
        return result.stdout
    chunks = []
    for offset in range(0, int(duration) + 1, 25):
        if duration - offset < .35:
            break
        pcm = extract(['-ss', str(offset), '-i', media, '-t', '25', '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'])
        if len(pcm) < 11200:
            continue
        header = struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', 36 + len(pcm), b'WAVE', b'fmt ', 16, 1, 1, 16000, 32000, 2, 16, b'data', len(pcm))
        chunks.append({'seconds': offset, 'wav': base64.b64encode(header + pcm).decode('ascii')})
    frames = []
    for portion in [.03, .2, .4, .6, .8, .95]:
        seconds = round(duration * portion, 2)
        data = extract(['-ss', str(seconds), '-i', media, '-frames:v', '1', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'])
        if data:
            frames.append({'seconds': seconds, 'jpeg': base64.b64encode(data).decode('ascii')})
    print(json.dumps({'sha256': receipt['sha256'], 'duration': duration, 'chunks': chunks, 'frames': frames}))

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Verified local media could not be extracted (five-minute limit).', file=sys.stderr)
        sys.exit(1)
