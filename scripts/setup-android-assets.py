"""Fetch only pinned public Android runtime/model assets. No accounts or secrets."""
from pathlib import Path
import argparse
import hashlib
import json
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
WAKE = ROOT / 'android/app/src/main/assets/wake'
MUSIC = ROOT / 'android/app/src/main/assets/music'
manifest = json.loads((WAKE / 'manifest.json').read_text(encoding='utf-8-sig'))
model = manifest['model']
MODEL_URL = f'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/{model}.tar.bz2'
MODEL_FILES = {
    'encoder.onnx': 'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'decoder.onnx': 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    'joiner.onnx': 'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
    'tokens.txt': 'tokens.txt',
}
MUSIC_SHA = '4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def valid(path, expected):
    return path.is_file() and not path.is_symlink() and digest(path) == expected

def download(url, path, limit):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.download')
    request = urllib.request.Request(url, headers={'User-Agent': 'JARVIS-public-asset-setup/1.0'})
    with urllib.request.urlopen(request, timeout=60) as source, temporary.open('wb') as output:
        length = 0
        while block := source.read(1024 * 1024):
            length += len(block)
            if length > limit:
                raise ValueError('Asset exceeds download bound')
            output.write(block)
    return temporary

def verify():
    for name, expected in manifest['files'].items():
        if not valid(WAKE / name, expected):
            raise ValueError(f'Missing or changed wake asset: {name}')
    engine = manifest['engineArtifact']
    if not valid(ROOT / 'android/app/libs' / engine['file'], engine['sha256']):
        raise ValueError('Missing or changed sherpa-onnx engine')
    if not valid(MUSIC / 'yamnet.tflite', MUSIC_SHA):
        raise ValueError('Missing or changed YAMNet model')
    print('Android wake, engine, and music asset checksums verified.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Verify installed files without downloading')
    if parser.parse_args().check:
        verify()
        return
    for name in ['keywords.txt', 'LICENSE.txt']:
        if not valid(WAKE / name, manifest['files'][name]):
            raise ValueError(f'Restore the reviewed static asset before setup: {name}')
    if not all(valid(WAKE / name, manifest['files'][name]) for name in MODEL_FILES):
        archive = ROOT / 'data/installers/android/wake-model.tar.bz2'
        temporary = download(MODEL_URL, archive, 300 * 1024 * 1024)
        with tarfile.open(temporary, 'r:bz2') as source:
            for destination, filename in MODEL_FILES.items():
                member = source.getmember(f'{model}/{filename}')
                if not member.isfile() or member.size > 64 * 1024 * 1024:
                    raise ValueError('Unexpected model archive member')
                with source.extractfile(member) as stream:
                    content = stream.read(member.size + 1)
                if len(content) != member.size or hashlib.sha256(content).hexdigest() != manifest['files'][destination]:
                    raise ValueError(f'Wake asset checksum mismatch: {destination}')
                target = WAKE / destination
                part = target.with_suffix(target.suffix + '.download')
                part.write_bytes(content)
                part.replace(target)
        temporary.replace(archive)
    engine = manifest['engineArtifact']
    for url, target, expected, limit in [
        (engine['source'], ROOT / 'android/app/libs' / engine['file'], engine['sha256'], 500 * 1024 * 1024),
        ('https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite', MUSIC / 'yamnet.tflite', MUSIC_SHA, 32 * 1024 * 1024),
    ]:
        if valid(target, expected):
            continue
        part = download(url, target, limit)
        if digest(part) != expected:
            raise ValueError(f'Public asset checksum mismatch: {target.name}')
        part.replace(target)
    verify()

if __name__ == '__main__':
    main()
