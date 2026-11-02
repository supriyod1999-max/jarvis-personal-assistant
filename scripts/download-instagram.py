"""Download and validate one public Instagram reel; no browser cookies or AI keys."""

import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from reel_library import identity, ReelLibrary

ROOT = Path(__file__).resolve().parents[1]
for package_dir in ("integrations/media-tools", "integrations/audio-tools"):
    sys.path.insert(0, str(ROOT / package_dir))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", help="A public instagram.com reel or post link")
    parser.add_argument("--collection", action="append", default=[], help="Preserve collection membership without another media copy")
    parser.add_argument("--directory", type=Path, help="Server-owned workspace library directory")
    parser.add_argument("--json-only", action="store_true")
    args = parser.parse_args()
    try:
        shortcode, source = identity(args.url)
    except ValueError as error:
        parser.error(str(error))
    if len(args.collection) > 100 or any(not name.strip() or len(name) > 200 for name in args.collection):
        parser.error("Use up to 100 non-empty collection names, at most 200 characters each.")
    destination = args.directory or ROOT / "output" / "instagram-download-check"
    with ReelLibrary(destination) as library:
        cached = library.cached(shortcode)
        if cached:
            receipt = library.save(cached, args.collection)
            print(json.dumps({"status": "already_saved", **receipt}, indent=2))
            if not args.json_only:
                print(f"Already saved, no network download: {destination / cached['file']}")
            return
        if (destination / f"{shortcode}.mp4").exists():
            # Preserve an unverified/modified file for inspection; never silently
            # overwrite it or treat it as an approved complete download.
            raise RuntimeError("An existing file has no matching valid receipt. Inspect it before retrying.")
        receipt = download(shortcode, source, destination)
        receipt = library.save(receipt, args.collection)
        temporary = destination / f"{shortcode}.receipt.tmp"
        temporary.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        temporary.replace(destination / f"{shortcode}.receipt.json")
        print(json.dumps(receipt, indent=2))
        if not args.json_only:
            print(f"Saved: {destination / receipt['file']}")


def download(shortcode, source, destination):

    import imageio_ffmpeg
    import yt_dlp
    from yt_dlp.version import __version__

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    options = {
        "outtmpl": str(destination / f"{shortcode}.%(ext)s"),
        "format": "bestvideo[ext=mp4][width<=1080][height<=1920]+bestaudio[ext=m4a]/best[ext=mp4]",
        "merge_output_format": "mp4",
        "ffmpeg_location": ffmpeg,
        "noplaylist": True,
        "socket_timeout": 20,
        "retries": 1,
        "extractor_retries": 1,
        "fragment_retries": 1,
        "max_filesize": 100 * 1024 * 1024,
        "cachedir": False,
        "noprogress": True,
        "quiet": True,
        "overwrites": False,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        raw = downloader.extract_info(source, download=False, process=False)
        if not raw or raw.get("id") != shortcode or raw.get("_type", "video") != "video":
            raise RuntimeError("The result was not the requested single reel.")
        info = downloader.process_ie_result(raw, download=True)
    media = destination / f"{shortcode}.mp4"
    if not media.is_file() or not media.stat().st_size:
        raise RuntimeError("No complete MP4 was downloaded.")

    # Decode every frame and audio packet. A partial or video-only file must fail.
    result = subprocess.run([
        ffmpeg, "-hide_banner", "-nostdin", "-xerror", "-i", str(media),
        "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-",
    ], capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError("Downloaded media failed full video/audio decoding.")
    duration_match = re.search(r"Duration: (\d+):(\d+):([\d.]+)", result.stderr)
    if not duration_match:
        raise RuntimeError("Could not verify the downloaded duration.")
    dimensions = re.search(r"Video:.*?\b(\d{2,5})x(\d{2,5})\b", result.stderr)
    if not dimensions:
        raise RuntimeError("Could not verify the downloaded dimensions.")
    hours, minutes, seconds = map(float, duration_match.groups())
    duration = hours * 3600 + minutes * 60 + seconds
    expected = info.get("duration")
    if expected and abs(duration - float(expected)) > max(1.0, float(expected) * .02):
        raise RuntimeError("Downloaded duration does not match Instagram metadata.")
    receipt = {
        "shortcode": shortcode, "sourceUrl": source,
        "title": info.get("title"), "creator": info.get("uploader"),
        "durationSeconds": duration, "sourceDurationSeconds": expected,
        "durationMatchedToSource": bool(expected),
        "width": int(dimensions.group(1)), "height": int(dimensions.group(2)),
        "bytes": media.stat().st_size,
        "sha256": hashlib.sha256(media.read_bytes()).hexdigest(),
        "audioVideoDecodePassed": True,
        "downloaderVersion": __version__,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "file": media.name,
    }
    # Keep only stable public metadata, never signed CDN links or credentials.
    return receipt


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Download check failed: {error}", file=sys.stderr)
        sys.exit(1)
