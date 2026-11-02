import { createChatGPT } from './chatgpt.mjs';
import { createHermes } from './hermes.mjs';

// Keep the existing connection available only during first-time setup. Once an
// app registration exists, failure/signout never silently routes back to Hermes.
export function createConversationProvider({ auth, direct = createChatGPT({ auth }), legacy = createHermes(), allowLegacy = true }) {
  async function choose() {
    const state = await auth.status();
    if (allowLegacy && state.state === 'signin' && state.accounts.length === 0) return legacy;
    return direct;
  }
  return {
    models: () => direct.models(),
    async status() {
      const provider = await choose(), status = await provider.status();
      return provider === legacy ? { ...status, provider: 'hermes', message: 'Using Hermes while direct ChatGPT sign-in is pending. Connect ChatGPT in Settings.' } : status;
    },
    run(prompt, onText, options) {
      let handle, cancelled = false;
      const done = (async () => {
        const provider = await choose();
        if (cancelled) return { cancelled: true, text: '' };
        handle = provider.run(prompt, onText, options);
        const result = await handle.done;
        return { ...result, provider: provider === legacy ? 'hermes' : 'chatgpt-direct' };
      })();
      return { done, cancel: async () => { cancelled = true; await handle?.cancel(); await done.catch(() => {}); } };
    },
  };
}
