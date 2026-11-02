// Fixed server-only operator file. No HTTP installation, environment path, live
// proof generation, automatic renewal, PIN inspection, or account discovery.
import { lstatSync, openSync, closeSync, fstatSync, readSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { hash, integrationError as fail } from './evergreen-contract.mjs';
import { prepareReviewedBridgeInstaller, REVIEWED_BRIDGE_WIRE } from './evergreen-reviewed-bridge-production.mjs';
import { prepareModuleAccessInstaller, MODULE_ACCESS_WIRE } from './evergreen-module-access-production.mjs';

export const evergreenReleasePath = directory => resolve(directory, 'evergreen-operator', 'reviewed-bridge-release.json');
export const evergreenModuleReleasePath = directory => resolve(directory, 'evergreen-operator', 'module-access-release.json');
const hold = () => { throw fail('release_held', 503); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function readBounded(path) {
  let fd;
  try {
    if (lstatSync(dirname(path)).isSymbolicLink() || lstatSync(path).isSymbolicLink()) hold();
    fd = openSync(path, 'r'); const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > 32768) hold();
    const bytes = Buffer.alloc(stat.size + 1); let count = 0, n;
    while (count < bytes.length && (n = readSync(fd, bytes, count, bytes.length - count, null))) count += n;
    if (count !== stat.size) hold();
    return bytes.subarray(0, count).toString('utf8');
  } catch { hold(); } finally { if (fd !== undefined) closeSync(fd); }
}

export function createEvergreenReleaseLoader({ directory, now = Date.now, storageFactory, fetcher } = {}) {
  const root = resolve(directory), oldPath = evergreenReleasePath(root), modulePath = evergreenModuleReleasePath(root), hosts = new Map();
  const present = path => { try { lstatSync(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; hold(); } };
  let path;
  let sealed = false, invalid = false, snapshot, factory, release;
  const assertInstallation = () => {
    if (!sealed || invalid || !factory || hosts.size !== 2 || present(path === oldPath ? modulePath : oldPath) || hash(readBounded(path)) !== snapshot) hold();
  };
  try {
    const modules = present(modulePath);
    if (modules && present(oldPath)) hold(); // No precedence or old-grant promotion.
    path = modules ? modulePath : oldPath;
    const raw = readBounded(path), document = JSON.parse(raw);
    if (!exact(document, ['format', 'operatorReviewed', 'release'])
      || document.format !== (modules ? 'jarvis-module-access-installation-v1' : 'jarvis-reviewed-bridge-installation-v1') || document.operatorReviewed !== true) hold();
    release = document.release;
    if (release?.members?.[0]?.profileId !== 'owner' || release?.members?.[1]?.profileId !== 'partner') hold();
    snapshot = hash(raw);
    factory = (modules ? prepareModuleAccessInstaller : prepareReviewedBridgeInstaller)({ release, wire: modules ? MODULE_ACCESS_WIRE : REVIEWED_BRIDGE_WIRE, now, storageFactory, fetcher, assertInstallation });
  } catch { invalid = true; }
  return {
    // Both normal app instances register their actual store-derived subject
    // during construction; no store ID supplied in the operator file is trusted
    // without this comparison. Seal is required before listeners start.
    registryFactory(options) {
      if (invalid || sealed || !factory) hold();
      const { profileId, subject, directory: actualDirectory } = options;
      const member = release.members.find(m => m.profileId === profileId);
      const expectedDirectory = profileId === 'owner' ? root : resolve(root, 'profiles', 'partner');
      if (!member || member.sessionSubject !== subject || resolve(actualDirectory) !== expectedDirectory || hosts.has(profileId)) {
        invalid = true; hold();
      }
      hosts.set(profileId, subject);
      return factory(options);
    },
    seal() {
      if (hosts.size !== 2 || !hosts.has('owner') || !hosts.has('partner')) invalid = true;
      sealed = true;
      return { held: invalid || !factory }; // No private principal/evidence data.
    },
  };
}
