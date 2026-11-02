import { mkdir, readFile, readdir, rename, open, lstat, realpath, link, unlink, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const MAX_FILE_BYTES = 20 * 1024 ** 3;
export const TRANSFER_CHUNK_BYTES = 8 * 1024 ** 2;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

// Only transfer metadata lives here; file bytes stream into the chosen destination.
// No expiry or retry timer. An explicit resume reconciles the committed offset.
export function createFileTransfers({ directory, locate, authorized, writable, validName }) {
  const store = join(directory, 'file-transfers'), busy = new Set();
  const receipt = state => ({ id: state.id, name: state.name, bytes: state.size, offset: state.offset, state: state.state, chunkBytes: TRANSFER_CHUNK_BYTES });
  const metadata = id => { if (!validId(id)) fail('Invalid transfer.'); return join(store, id + '.json'); };
  async function save(state) {
    await mkdir(store, { recursive: true });
    const target = metadata(state.id);
    const file = await open(target + '.tmp', 'w', 0o600);
    try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
    await rename(target + '.tmp', target);
  }
  async function load(id) {
    try { return JSON.parse(await readFile(metadata(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail('This upload is unavailable. Select the file again.', 404); throw error; }
  }
  async function exclusive(id, action) {
    metadata(id);
    if (busy.has(id)) fail('This upload is still settling. Resume again in a moment.', 409);
    busy.add(id); try { return await action(); } finally { busy.delete(id); }
  }
  async function destination(state, check) {
    const folder = await locate(state.share, state.path, true);
    authorized(state.share, check);
    // A moved drive or replacement directory cannot receive an earlier operation.
    if (folder.path !== state.folder || folder.stat.ino !== state.folderIno || folder.stat.dev !== state.folderDev) fail('The destination folder changed. Start a new transfer.', 409);
    const target = join(folder.path, state.name), temp = join(folder.path, '.jarvis-upload-' + state.id);
    writable(target); return { target, temp };
  }
  async function tempFile(path, state) {
    const before = await lstat(path);
    if (before.isSymbolicLink() || !before.isFile() || await realpath(path) !== path || before.ino !== state.tempIno || before.dev !== state.tempDev) fail('The partial file changed. Start a new transfer.', 409);
    const file = await open(path, 'r+'); const after = await file.stat();
    if (after.ino !== before.ino || after.dev !== before.dev) { await file.close(); fail('The partial file changed.', 409); }
    return file;
  }
  async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  return {
    async list(check) {
      if(!check())fail('Unlock JARVIS to view transfers.',401);
      let names;try{names=await readdir(store);}catch(error){if(error.code==='ENOENT')return [];throw error;}
      const entries=[];
      for(const name of names.filter(name=>name.endsWith('.json')&&validId(name.slice(0,-5))).slice(-200)){
        try{const state=await load(name.slice(0,-5));await destination(state,check);entries.push(receipt(state));}catch(error){if(!check())throw error;}
      }
      if(!check())fail('Transfer access ended.',401);return entries;
    },
    async begin(input, check) {
      return exclusive(input.id, async () => {
        if (!validName(input.name) || !Number.isSafeInteger(input.size) || input.size < 0 || input.size > MAX_FILE_BYTES) fail('Choose a file up to 20 GB.');
        let previous; try { previous = await load(input.id); } catch (error) { if (error.status !== 404) throw error; }
        if (previous) {
          if (previous.share !== input.share || previous.path !== (input.path || '') || previous.name !== input.name || previous.size !== input.size) fail('This transfer belongs to a different file.', 409);
          await destination(previous, check); return receipt(previous);
        }
        const folder = await locate(input.share, input.path || '', true); authorized(input.share, check);
        const target = join(folder.path, input.name); writable(target);
        if (await exists(target)) fail('A file with that name already exists. Choose a different name to keep both.', 409);
        const disk = await statfs(folder.path, { bigint: true });
        if (disk.bavail * disk.bsize < BigInt(input.size)) fail('There is not enough free space in this destination.', 507);
        authorized(input.share, check);
        const temp = join(folder.path, '.jarvis-upload-' + input.id), file = await open(temp, 'wx', 0o600);
        const stat = await file.stat(); await file.close();
        const state = { id: input.id, share: input.share, path: input.path || '', name: input.name, size: input.size, offset: 0, state: 'uploading', folder: folder.path, folderIno: folder.stat.ino, folderDev: folder.stat.dev, tempIno: stat.ino, tempDev: stat.dev };
        try { await save(state); } catch (error) { await unlink(temp).catch(() => {}); throw error; }
        return receipt(state);
      });
    },
    async status(id, check) { return exclusive(id, async () => { const state = await load(id); await destination(state, check); return receipt(state); }); },
    async append(id, offset, digest, request, check) {
      return exclusive(id, async () => {
        const state = await load(id), { temp } = await destination(state, check);
        if (state.state !== 'uploading' || !Number.isSafeInteger(offset) || offset !== state.offset) fail('Upload progress changed. Resume to check the saved position.', 409);
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) fail('Missing file integrity check.');
        const expected = Math.min(TRANSFER_CHUNK_BYTES, state.size - state.offset);
        if (!expected || Number(request.headers['content-length']) > expected) fail('Unexpected upload chunk.', 413);
        const file = await tempFile(temp, state), hash = createHash('sha256'); let bytes = 0;
        try {
          if ((await file.stat()).size < state.offset) fail('The partial file was shortened.', 409);
          await file.truncate(state.offset); // Recover an interrupted, uncommitted chunk.
          for await (const chunk of request) {
            authorized(state.share, check); bytes += chunk.length;
            if (bytes > expected) fail('Unexpected upload chunk.', 413);
            hash.update(chunk);
            let written = 0;
            while (written < chunk.length) {
              const result = await file.write(chunk, written, chunk.length - written, state.offset + bytes - chunk.length + written);
              if (!result.bytesWritten) fail('Could not write this file.', 507);
              written += result.bytesWritten;
            }
          }
          if (bytes !== expected || hash.digest('hex') !== digest) fail('File integrity check failed. Resume to resend this part.', 409);
          await file.sync(); authorized(state.share, check);
          const next = { ...state, offset: state.offset + bytes };
          await save(next); return receipt(next);
        } catch (error) { await file.truncate(state.offset).catch(() => {}); throw error; }
        finally { await file.close(); }
      });
    },
    async finish(id, check) {
      return exclusive(id, async () => {
        const state = await load(id), { temp, target } = await destination(state, check);
        if (state.state === 'complete') return receipt(state);
        if (state.state !== 'uploading' || state.offset !== state.size) fail('Upload is not complete.', 409);
        const file = await tempFile(temp, state);
        try { if ((await file.stat()).size !== state.size) fail('The partial file changed.', 409); await file.sync(); } finally { await file.close(); }
        authorized(state.share, check);
        try { await link(temp, target); }
        catch (error) {
          // Recover a completed link whose receipt was interrupted by a restart.
          const existing = await exists(target);
          if (error.code !== 'EEXIST' || !existing || existing.isSymbolicLink() || existing.ino !== state.tempIno || existing.dev !== state.tempDev || existing.size !== state.size) fail('A file with that name already exists. Choose a different name to keep both.', 409);
        }
        state.state = 'complete'; await save(state); await unlink(temp).catch(() => {}); return receipt(state);
      });
    },
    async cancel(id, check) {
      return exclusive(id, async () => {
        const state = await load(id), { temp } = await destination(state, check);
        if (state.state === 'uploading') {
          const target = join(state.folder, state.name), existing = await exists(target);
          if (existing && !existing.isSymbolicLink() && existing.ino === state.tempIno && existing.dev === state.tempDev && existing.size === state.size && state.offset === state.size) {
            state.state = 'complete'; await save(state); await unlink(temp).catch(() => {}); return receipt(state);
          }
          // Validate identity before deleting only this operation's partial file.
          if (await exists(temp)) { const file = await tempFile(temp, state); await file.close(); await unlink(temp); }
          state.state = 'cancelled'; await save(state);
        }
        return receipt(state);
      });
    },
  };
}
