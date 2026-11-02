// One-time setup, used before the main server loads the direct connection.
import { createChatGPTAuth } from '../server/chatgpt-auth.mjs';
import { resolve } from 'node:path';
const auth = createChatGPTAuth({ directory: resolve('data') });
try {
  const status = await auth.status();
  if (status.state === 'ready') console.log('Direct ChatGPT connection is already authenticated.');
  else {
    const result = await auth.start(status.selected || status.accounts.at(-1)?.id || null);
    console.log(result.url);
    for (let i = 0; i < 600; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const next = await auth.status();
      if (!next.pending) { console.log(next.state === 'ready' ? 'Direct ChatGPT connection authenticated.' : next.message); break; }
    }
  }
} finally { await auth.close(); }
