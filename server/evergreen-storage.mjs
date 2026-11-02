import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { credentialVault } from './credential-vault.mjs';

// The OS vault holds only the encryption key. Records, secrets, proposals, cursors
// and receipts are all authenticated ciphertext, including temporary files.
export function evergreenStorage(directory, { vault = credentialVault(join(directory, 'evergreen/key.dpapi')) } = {}) {
  const folder = join(directory, 'evergreen'), path = join(folder, 'companion.enc');
  let key, opening;
  async function init() {
    opening ||= (async () => {
      await vault.acquire();
      let saved = await vault.read();
      if (!saved) {
        try { await readFile(path); throw new Error('Evergreen encryption key is missing. Recovery is required.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        saved = { key: randomBytes(32).toString('base64') }; await vault.write(saved);
      }
      key = Buffer.from(saved.key, 'base64'); if (key.length !== 32) throw new Error('Evergreen encryption key is invalid.');
    })();
    await opening;
  }
  return {
    async read() {
      await init(); let bytes;
      try { bytes = await readFile(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      if (bytes.length > 32 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'EJV1') throw new Error('Evergreen encrypted cache is invalid.');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(4, 16));
      decipher.setAAD(Buffer.from('JARVIS Evergreen companion v1')); decipher.setAuthTag(bytes.subarray(16, 32));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(32)), decipher.final()]).toString('utf8'));
    },
    async write(value) {
      await init(); const plain = Buffer.from(JSON.stringify(value));
      if (plain.length > 24 * 1024 * 1024) throw new Error('Evergreen local cache capacity reached. No cursor was advanced.');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from('JARVIS Evergreen companion v1'));
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      await mkdir(folder, { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(Buffer.concat([Buffer.from('EJV1'), iv, cipher.getAuthTag(), body])); await file.sync(); } finally { await file.close(); }
        // Antivirus/indexing can briefly lock an encrypted file on Windows.
        // Retry only the same atomic local rename; never remove the old file or
        // replay any network mutation because of a filesystem failure.
        for (let attempt = 0; ; attempt++) {
          try { await rename(temp, path); break; }
          catch (e) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt === 4) throw e; await new Promise(done => setTimeout(done, 50 * 2 ** attempt)); }
        }
      } finally { await unlink(temp).catch(() => {}); }
    },
    async close() { if (opening) { await opening.catch(() => {}); key?.fill(0); await vault.release(); } },
  };
}
