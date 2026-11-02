import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from reel_library import identity, ReelLibrary, digest

class ReelDedupTests(unittest.TestCase):
    def test_url_variants_share_identity_and_collections_not_another_file(self):
        root = ROOT / '.test-data'
        root.mkdir(exist_ok=True)
        with TemporaryDirectory(dir=root) as temp:
            path = Path(temp)
            code, source = identity('https://www.instagram.com/reel/Abc123xyz/?tracking=one')
            self.assertEqual(identity('https://instagram.com/p/Abc123xyz/')[0], code)
            media = path / (code + '.mp4')
            media.write_bytes(b'synthetic verified media')
            receipt = dict(shortcode=code, sourceUrl=source, file=media.name,
                           audioVideoDecodePassed=True, bytes=media.stat().st_size, sha256=digest(media))
            with ReelLibrary(path) as library:
                first = library.save(receipt, ['Apps'])
            with ReelLibrary(path) as library:
                cached = library.cached(code)
                second = library.save(cached, ['Recipes', 'Apps'])
                self.assertEqual(second['collections'], ['Apps', 'Recipes'])
                self.assertEqual(first['knowledgeRecordId'], second['knowledgeRecordId'])
            self.assertEqual(len(list(path.glob('*.mp4'))), 1)
            media.write_bytes(b'modified')
            with ReelLibrary(path) as library:
                self.assertIsNone(library.cached(code))

    def test_concurrent_claims_do_not_download_twice(self):
        with TemporaryDirectory(dir=ROOT / '.test-data') as temp:
            with ReelLibrary(temp):
                with self.assertRaisesRegex(RuntimeError, 'Another reel import'):
                    with ReelLibrary(temp):
                        self.fail('second import acquired claim')

if __name__ == '__main__':
    unittest.main()
