"""Fetch pinned upstream Windows CUDA runtime and FP32 Kokoro, without credentials."""
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from pathlib import Path
import shutil
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
WHEEL = 'sherpa_onnx-1.13.8+cuda12.cudnn9-cp311-cp311-win_amd64.whl'
FILES = [
    (ROOT / 'data/installers/kokoro-gpu' / WHEEL, 201523225, '682e761793dc58a9e8124d674f071b20c8f6ef962180b7336bcc646f90464356',
     'https://huggingface.co/csukuangfj2/sherpa-onnx-wheels/resolve/cda0e75f7c6a588ac3ecb99933749b48b2e3cc60/cuda/1.13.8/' + WHEEL.replace('+', '%2B')),
    (ROOT / 'data/voice-models/kokoro-gpu/model.onnx', 325560556, 'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11',
     'https://huggingface.co/csukuangfj/kokoro-multi-lang-v1_0/resolve/f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b/model.onnx'),
]

def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()

def part(job):
    target, size, sha, url, start, end = job
    folder = target.parent / (target.name + '.parts')
    folder.mkdir(parents=True, exist_ok=True)
    piece = folder / str(start)
    length = end - start + 1
    if piece.is_file() and piece.stat().st_size == length:
        return piece
    for attempt in range(4):
        try:
            request = urllib.request.Request(url + f'?download=true&part={start}&attempt={attempt}', headers={'Range': f'bytes={start}-{end}', 'User-Agent': 'JARVIS-local-voice-setup/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{size}':
                    raise ValueError('Model host did not return the exact pinned range')
                written = 0
                with piece.open('wb') as output:
                    while block := response.read(262144):
                        written += len(block)
                        if written > length:
                            raise ValueError('Range exceeded its bound')
                        output.write(block)
                if written != length:
                    raise ValueError('Incomplete model range')
                return piece
        except Exception:
            if attempt == 3:
                raise RuntimeError(f'Public download range {start} failed; rerun to resume') from None
            time.sleep(2 ** attempt)

def main():
    jobs = []
    pending = []
    for target, size, sha, url in FILES:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.is_file() and target.stat().st_size == size and digest(target) == sha:
            print(f'{target.name}: checksum verified', flush=True)
            continue
        plan = [(target, size, sha, url, start, min(size, start + 8 * 1024 ** 2) - 1) for start in range(0, size, 8 * 1024 ** 2)]
        pending.append((target, size, sha, plan))
        jobs.extend(plan)
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(part, job) for job in jobs]
        for count, future in enumerate(as_completed(futures), 1):
            future.result()
            if count % 8 == 0 or count == len(jobs):
                print(f'GPU model/runtime ranges ready: {count}/{len(jobs)}', flush=True)
    for target, size, sha, plan in pending:
        temporary = target.with_suffix(target.suffix + '.download')
        with temporary.open('wb') as output:
            for job in plan:
                with part(job).open('rb') as source:
                    shutil.copyfileobj(source, output, 1024 * 1024)
        if temporary.stat().st_size != size or digest(temporary) != sha:
            raise ValueError('Pinned GPU asset checksum mismatch')
        temporary.replace(target)
        print(f'{target.name}: SHA-256 verified', flush=True)

if __name__ == '__main__':
    main()
