import { packager } from '@electron/packager';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const dependency = JSON.parse(await readFile(resolve(root, 'node_modules/electron/package.json'), 'utf8'));
await writeFile(resolve(root, 'desktop/runtime.json'), JSON.stringify({ root }));
const paths = await packager({ dir: resolve(root, 'desktop'), name: 'JARVIS', platform: 'win32', arch: 'x64', electronVersion: dependency.version, out: resolve(root, 'output/desktop'), overwrite: true, asar: true, download: { cacheRoot: resolve(root, '.npm-cache/electron') }, appCopyright: 'JARVIS Personal', win32metadata: { CompanyName: 'JARVIS Personal', FileDescription: 'JARVIS Desktop', ProductName: 'JARVIS' } });
console.log('Desktop app built:', paths.join(', '));
