"""Install a pinned public Kokoro CPU model. No credentials, reference audio or inference."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'data' / 'voice-models' / 'kokoro'
NAME = 'kokoro-int8-multi-lang-v1_0'
SIZE = 132303094
SHA = '4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e'
URL = f'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{NAME}.tar.bz2'

def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    archive = DEST / (NAME + '.tar.bz2')
    if not archive.is_file() or archive.stat().st_size != SIZE or digest(archive) != SHA:
        partial = archive.with_suffix('.download')
        request = urllib.request.Request(URL, headers={'User-Agent': 'JARVIS-local-voice-setup/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as target:
            written = 0
            while block := response.read(1024 * 1024):
                written += len(block)
                if written > SIZE:
                    raise ValueError('Model archive exceeded its pinned size')
                target.write(block)
        if written != SIZE or digest(partial) != SHA:
            raise ValueError('Kokoro archive checksum mismatch; nothing will be loaded')
        partial.replace(archive)
    print('Kokoro archive SHA-256 verified', flush=True)
    files = {}
    total = 0
    with tarfile.open(archive, 'r:bz2') as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != NAME or '\\' in member.name:
                raise ValueError('Unexpected model archive path')
            target = DEST.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if not member.isfile():
                raise ValueError('Model archive links and special files are refused')
            total += member.size
            if total > 1024 ** 3:
                raise ValueError('Model archive exceeds the extraction limit')
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as stream, target.open('wb') as output:
                shutil.copyfileobj(stream, output, 1024 * 1024)
            files[path.as_posix()] = {'bytes': member.size, 'sha256': digest(target)}
    manifest = {'engine': 'Kokoro 82M', 'runtime': 'sherpa-onnx==1.13.8', 'archive': NAME + '.tar.bz2', 'archiveSha256': SHA, 'source': URL, 'voice': 'bm_daniel', 'speakerId': 24, 'files': files}
    temporary = DEST / 'manifest.json.tmp'
    temporary.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    temporary.replace(DEST / 'manifest.json')
    print(f'Kokoro assets verified: {len(files)} files, {total:,} bytes', flush=True)

if __name__ == '__main__':
    main()
