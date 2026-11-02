import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

export const OWNER_PROFILE = { id: 'owner', displayName: 'Owner', addressAs: 'sir' };
export function validateProfile(value) {
  if (!value || !/^[a-z][a-z0-9-]{0,39}$/.test(value.id) || typeof value.displayName !== 'string' || !value.displayName.trim() || value.displayName.length > 80 || /[\r\n]/.test(value.displayName) || typeof value.addressAs !== 'string' || value.addressAs.length > 40 || /[\r\n]/.test(value.addressAs)) throw new Error('Invalid JARVIS profile.');
  return { id: value.id, displayName: value.displayName.trim(), addressAs: value.addressAs.trim() };
}

export function additionalProfiles(rootDirectory) {
  const path = join(rootDirectory, 'instances.json');
  if (!existsSync(path)) return [];
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.version !== 1 || !Array.isArray(value.profiles) || value.profiles.length > 1) throw new Error('Configure at most one additional JARVIS profile.');
  return value.profiles.map(raw => {
    const profile = validateProfile(raw);
    if (profile.id === 'owner' || !Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535 || [4317, 4318].includes(raw.port)) throw new Error('Use a separate port and identity for the second profile.');
    const directory = resolve(rootDirectory, 'profiles', profile.id);
    if (!directory.startsWith(resolve(rootDirectory, 'profiles') + sep)) throw new Error('Invalid profile directory.');
    if (raw.shareOwnerChat !== undefined && typeof raw.shareOwnerChat !== 'boolean') throw new Error('Choose whether this personal workspace shares the primary model connection.');
    return { profile, directory, port: raw.port, shareOwnerChat: raw.shareOwnerChat === true };
  });
}
