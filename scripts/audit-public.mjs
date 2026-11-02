import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const privateDirs = new Set(['data', '.test-data', 'integrations', 'output', 'dist', 'node_modules', '.npm-cache', 'test-results', 'playwright-report', '.git', '.codex', '.agents', '.codex-remote-attachments', '.local']);
const binaryAssets = new Set(['public/icon-192.png', 'public/icon-512.png', 'docs/images/tasks-desktop.png', 'docs/images/tasks-mobile.png', 'docs/images/voice-settings.png']);
const forbidden = /(?:\.(?:sqlite(?:-wal|-shm)?|db|dpapi|pem|key|p12|pfx|jks|keystore|wav|mp3|mp4|apk|aab|exe|dll|onnx|tflite|bin|aar|jar|log)(?:\..*)?$|(?:^|\/)\.env(?:\..*)?$|(?:^|\/)(?:local\.properties|runtime\.json)$)/i;
const findings = [];
function report(path, rule, line) { findings.push({ path, rule, ...(line ? { line } : {}) }); }
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = resolve(dir, entry.name), path = relative(root, full).split(sep).join('/');
    if (entry.isSymbolicLink()) { report(path, 'linked-file-or-directory'); return []; }
    if (entry.isDirectory()) return privateDirs.has(entry.name) || ['build', '.gradle', '.avd', '__pycache__'].includes(entry.name) ? [] : walk(full);
    return [path];
  });
}
let files;
try {
  // Read only Git's index/worktree file inventory; never print content or secrets.
  files = [...new Set(execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).split('\0').filter(Boolean))];
} catch { files = walk(root); }
const signatures = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['provider-key', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}\b/],
  ['private-tailnet', /\btail[0-9a-f]{6,}\.ts\.net\b/i],
  ['literal-user-home', /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|…)[a-z0-9_.-]+/i],
];
for (const path of files) {
  if (path.split('/').some(part => privateDirs.has(part))) report(path, 'private-runtime-directory');
  if (forbidden.test(path) && path !== '.env.example') report(path, 'private-or-generated-file');
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + sep)) { report(path, 'outside-root'); continue; }
  const stat = lstatSync(full);
  if (stat.isSymbolicLink()) { report(path, 'linked-file'); continue; }
  if (stat.size > 2 * 1024 * 1024) report(path, 'large-unreviewed-file');
  const bytes = readFileSync(full);
  if (binaryAssets.has(path)) continue;
  if (bytes.includes(0)) { report(path, 'unreviewed-binary'); continue; }
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [rule, pattern] of signatures) if (pattern.test(line)) report(path, rule, index + 1);
  });
}
if (findings.length) { console.error(JSON.stringify({ state: 'blocked', files: files.length, findings }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ state: 'passed', files: files.length, scope: 'prospective Git files', limitation: 'Targeted scan; manually review staged content and use an independent secret scanner before publication.' }, null, 2));
