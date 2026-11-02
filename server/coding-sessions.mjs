import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import reader from '../desktop/codex-sessions.cjs';

// The same bounded, display-only reader used by the Windows island. No agent
// commands, credentials, tool output or approval actions cross this boundary.
export function createPhoneCoding({ directory, sessions = reader.createCodexSessions() }) {
  let pending;
  async function enabled() {
    try { return JSON.parse(await readFile(join(directory, 'desktop/preferences.json'), 'utf8')).codingEnabled !== false; }
    catch (error) { return error.code === 'ENOENT'; }
  }
  return {
    isMonitoringEnabled: enabled,
    async snapshot(authorized) {
      if (!authorized() || !await enabled()) { sessions.clear(); return { enabled: false, sessions: [], message: 'Coding monitoring is paused. Resume it in the Windows island.' }; }
      pending ||= sessions.scan().finally(() => { pending = undefined; });
      const result = await pending;
      // A lock or pause while files were being read revokes the response too.
      if (!authorized() || !await enabled()) { sessions.clear(); return { enabled: false, sessions: [], message: 'Unlock JARVIS to view coding activity.' }; }
      return { enabled: true, ...result };
    },
    clear: () => sessions.clear(),
  };
}
