"""Resume the two public voice checkpoints in bounded, verified HTTP ranges."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from pathlib import Path
import shutil
import time
import requests

ROOT = Path(__file__).resolve().parent.parent
REV = '749d1c1a46eb10492095d68fbcf55691ccf137cd'
CACHE = ROOT / 'data' / 'voice-models' / 'hub' / 'models--ResembleAI--chatterbox-turbo'
DEST = CACHE / 'snapshots' / REV
PARTS = ROOT / 'data' / 'voice-downloads'
DEST.mkdir(parents=True, exist_ok=True)
PARTS.mkdir(parents=True, exist_ok=True)
MODELS = [
    ('t3_turbo_v1.safetensors', 1915480052, 'fcf1f8c1d651bb7e3acd69ee5be269b4ac10c02980b7708213d598bc9f7cdf87'),
    ('s3gen_meanflow.safetensors', 1064875036, 'd65cb687a2ed581ee6cc297e919ffefa63386944f42364ae13b78a594945514f'),
]
def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def segment(name, start, end):
    path = PARTS / f'{name}.{start}-{end}'
    length = end - start + 1
    if path.is_file() and path.stat().st_size == length:
        return path
    url = f'https://huggingface.co/ResembleAI/chatterbox-turbo/resolve/{REV}/{name}?download=true&segment={start}'
    for attempt in range(5):
        try:
            existing = path.stat().st_size if path.is_file() else 0
            if existing > length:
                raise RuntimeError('Unexpected segment size')
            if existing == length:
                return path
            resumed = start + existing
            with requests.get(url + f'&resume={resumed}', headers={'Range': f'bytes={resumed}-{end}'}, stream=True, timeout=(30, 45)) as response:
                response.raise_for_status()
                if response.status_code != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {resumed}-{end}/'):
                    raise RuntimeError('Model host did not return the requested byte range')
                written = existing
                with path.open('ab') as target:
                    for chunk in response.iter_content(262144):
                        written += len(chunk)
                        if written > length:
                            raise RuntimeError('Model range exceeded the expected size')
                        target.write(chunk)
                if written != length:
                    raise RuntimeError('Incomplete model range')
            return path
        except Exception:
            if attempt == 4:
                raise RuntimeError(f'Download segment {start} did not complete. Run setup again to resume.') from None
            time.sleep(min(20, 2 ** attempt))

jobs = []
plans = []
for name, size, sha in MODELS:
    target = DEST / name
    if target.is_file() and digest(target) == sha:
        print(f'{name}: checksum already verified', flush=True)
        continue
    candidates = [p for p in (CACHE / 'blobs').glob(sha + '*.incomplete') if 0 < p.stat().st_size <= size]
    prefix = max(candidates, key=lambda p: p.stat().st_size) if candidates else None
    offset = prefix.stat().st_size if prefix else 0
    pieces = []
    for start in range(offset, size, 16 * 1024 * 1024):
        end = min(size, start + 16 * 1024 * 1024) - 1
        pieces.append((name, start, end))
    plans.append((name, size, sha, prefix, pieces))
    jobs.extend(pieces)
    print(f'{name}: resuming at {offset:,} of {size:,} bytes', flush=True)

with ThreadPoolExecutor(max_workers=32) as executor:
    pending = {executor.submit(segment, *job): job for job in jobs}
    for number, future in enumerate(as_completed(pending), 1):
        future.result()
        print(f'Checkpoint segments ready: {number}/{len(jobs)}', flush=True)

for name, size, sha, prefix, pieces in plans:
    temporary = DEST / (name + '.download')
    with temporary.open('wb') as target:
        if prefix:
            with prefix.open('rb') as source:
                shutil.copyfileobj(source, target, 1024 * 1024)
        for piece in pieces:
            with segment(*piece).open('rb') as source:
                shutil.copyfileobj(source, target, 1024 * 1024)
    if temporary.stat().st_size != size or digest(temporary) != sha:
        raise RuntimeError(f'{name}: checksum mismatch; the checkpoint will not be loaded.')
    temporary.replace(DEST / name)
    print(f'{name}: SHA-256 verified', flush=True)
