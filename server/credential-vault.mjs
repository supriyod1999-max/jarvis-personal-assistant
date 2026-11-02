import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Tokens travel only through child-process pipes, never command arguments or logs.
function protect(value, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('This connection requires the Windows credential vault.');
  const script = `Add-Type -AssemblyName System.Security; $value = [Console]::In.ReadToEnd(); $bytes = ${decrypt ? '[Convert]::FromBase64String($value)' : '[Text.Encoding]::UTF8.GetBytes($value)'}; $result = [Security.Cryptography.ProtectedData]::${decrypt ? 'Unprotect' : 'Protect'}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${decrypt ? '[Text.Encoding]::UTF8.GetString($result)' : '[Convert]::ToBase64String($result)'});`;
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 1000000) child.kill(); });
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('Windows could not open the credential vault.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 && output ? resolve(output) : reject(new Error('Windows could not open the credential vault.')); });
    child.stdin.end(value);
  });
}

export function credentialVault(path) {
  const owner = JSON.stringify({ pid: process.pid, id: randomUUID() });
  let locked = false;
  return {
    async acquire() {
      await mkdir(dirname(path), { recursive: true });
      for (let i = 0; i < 3; i++) {
        try { await writeFile(`${path}.lock`, owner, { flag: 'wx', mode: 0o600 }); locked = true; return; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          let raw; try { raw = await readFile(`${path}.lock`, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
          let pid; try { pid = JSON.parse(raw).pid; } catch { throw new Error('The credential lock needs attention.'); }
          if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('The credential lock needs attention.');
          try { process.kill(pid, 0); throw new Error('Another Second Brain process is using the ChatGPT connection.'); }
          catch (e) { if (e.code !== 'ESRCH') throw e; }
          if (await readFile(`${path}.lock`, 'utf8') === raw) await unlink(`${path}.lock`).catch(e => { if (e.code !== 'ENOENT') throw e; });
        }
      }
      throw new Error('Another process is opening the ChatGPT connection.');
    },
    async release() { if (locked && await readFile(`${path}.lock`, 'utf8').catch(() => '') === owner) await unlink(`${path}.lock`); locked = false; },
    async read() { try { return JSON.parse(await protect(await readFile(path, 'utf8'), true)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async write(value) {
      const encrypted = await protect(JSON.stringify(value));
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      await writeFile(temp, encrypted, { mode: 0o600, flag: 'wx' });
      await rename(temp, path);
    },
  };
}
