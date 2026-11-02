"""Local reel identity, collection membership and cross-process duplicate protection."""
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit
from uuid import NAMESPACE_URL, uuid5


def identity(value):
    url = urlsplit(value)
    match = re.fullmatch(r"/(?:[A-Za-z0-9_.]+/)?(?:reel|p)/([A-Za-z0-9_-]{5,32})/?", url.path)
    if url.scheme != "https" or url.netloc not in ("instagram.com", "www.instagram.com") or not match:
        raise ValueError("Use an HTTPS Instagram reel or post link.")
    code = match.group(1)
    return code, f"https://www.instagram.com/reel/{code}/"


def digest(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class ReelLibrary:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.directory / "reels.sqlite", timeout=2)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS reels(shortcode TEXT PRIMARY KEY, receipt TEXT NOT NULL)")

    def __enter__(self):
        # Keep the claim until download+validation finishes. A crash releases it;
        # a competing manual/daily process cannot download the same reel twice.
        try:
            self.db.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            self.db.close()
            raise RuntimeError("Another reel import is running. Retry after it finishes.") from None
        return self

    def __exit__(self, error_type, error, trace):
        try:
            self.db.rollback() if error_type else self.db.commit()
        finally:
            self.db.close()

    def cached(self, code):
        row = self.db.execute("SELECT receipt FROM reels WHERE shortcode=?", (code,)).fetchone()
        receipt_path = self.directory / f"{code}.receipt.json"
        try:
            receipt = json.loads(row[0]) if row else json.loads(receipt_path.read_text(encoding="utf-8"))
            file = self.directory / f"{code}.mp4"
            if (receipt.get("shortcode") == code and receipt.get("file") == file.name
                    and receipt.get("audioVideoDecodePassed") is True and file.is_file()
                    and receipt.get("bytes") == file.stat().st_size and receipt.get("sha256") == digest(file)):
                return receipt
        except (FileNotFoundError, ValueError, TypeError):
            pass
        return None

    def save(self, receipt, collections):
        code = receipt["shortcode"]
        row = self.db.execute("SELECT receipt FROM reels WHERE shortcode=?", (code,)).fetchone()
        previous = json.loads(row[0]) if row else {}
        names = sorted(set(previous.get("collections", []) + receipt.get("collections", []) + collections))
        value = {**receipt, "collections": names, "knowledgeRecordId": str(uuid5(NAMESPACE_URL, receipt["sourceUrl"]))}
        self.db.execute("INSERT INTO reels VALUES(?,?) ON CONFLICT(shortcode) DO UPDATE SET receipt=excluded.receipt", (code, json.dumps(value)))
        return value
