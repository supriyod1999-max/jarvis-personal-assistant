"""Download and verify the smaller public Whisper model for conversational latency."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import requests
import time

root = Path(__file__).resolve().parent.parent / 'data' / 'speech-input'
root.mkdir(parents=True, exist_ok=True)
target = root / 'ggml-base.bin'
revision = '5359861c739e955e79d9a303bcbc70fb988958b1'
checksum = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
size = 147951465
def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()
if target.is_file() and digest(target) == checksum:
    print('Whisper Base: checksum verified', flush=True)
    raise SystemExit(0)
def part(start):
    end = min(size, start + 8 * 1024 * 1024) - 1
    path = root / f'base.{start}.part'
    for attempt in range(5):
        offset = path.stat().st_size if path.exists() else 0
        if offset == end - start + 1:
            return path
        url = f'https://huggingface.co/ggerganov/whisper.cpp/resolve/{revision}/ggml-base.bin?download=true&segment={start}&offset={offset}'
        try:
            with requests.get(url, headers={'Range': f'bytes={start + offset}-{end}'}, stream=True, timeout=(30, 45)) as response:
                response.raise_for_status()
                if response.status_code != 206 or response.headers.get('Content-Range') != f'bytes {start + offset}-{end}/{size}':
                    raise RuntimeError('Unexpected model range')
                with path.open('ab') as output:
                    for block in response.iter_content(262144):
                        offset += len(block)
                        if offset > end - start + 1:
                            raise RuntimeError('Unexpected model size')
                        output.write(block)
            if offset != end - start + 1:
                raise RuntimeError('Incomplete model range')
            return path
        except Exception:
            if attempt == 4:
                raise RuntimeError('Model download paused. Run this command again to resume.') from None
            time.sleep(2 ** attempt)
starts = list(range(0, size, 8 * 1024 * 1024))
with ThreadPoolExecutor(max_workers=12) as workers:
    jobs = {workers.submit(part, start): start for start in starts}
    for count, future in enumerate(as_completed(jobs), 1):
        future.result()
        print(f'Whisper Base segments ready: {count}/{len(starts)}', flush=True)
temporary = root / 'ggml-base.bin.download'
with temporary.open('wb') as output:
    for start in starts:
        output.write(part(start).read_bytes())
if temporary.stat().st_size != size or digest(temporary) != checksum:
    raise RuntimeError('Whisper model failed checksum verification.')
temporary.replace(target)
print('Whisper Base: SHA-256 verified', flush=True)
