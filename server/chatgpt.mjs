import { MODEL } from './hermes.mjs';

function providerError(status, code) {
  if (status === 429 || code === 'usage_limit_exceeded') return new Error('Your ChatGPT plan usage limit was reached. Check ChatGPT Settings → Usage.');
  if (status === 401) return new Error('Your ChatGPT sign-in needs attention. Reconnect in Settings.');
  if (status === 403) return new Error('This ChatGPT account has not enabled plan use for JARVIS. Check its app permissions.');
  if (code === 'model_not_found') return new Error('The selected model is unavailable for this connection. No other model was used.');
  return new Error('ChatGPT could not complete this reply. Your message is saved; no automatic retry was made.');
}

export function createChatGPT({ auth, fetcher = fetch, timeout = 150000 } = {}) {
  let catalog;
  async function listModels(token, signal) {
    if (catalog?.token === token && Date.now() - catalog.checked < 300000) return catalog.models;
    const response = await fetcher('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal });
    if (!response.ok) throw providerError(response.status);
    const data = await response.json();
    if (!Array.isArray(data.models)) throw new Error('ChatGPT returned an unreadable model catalog.');
    const models = data.models.filter(model => typeof model.slug === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(model.slug) && (model.visibility === 'list' || model.slug === MODEL && model.visibility === undefined)).slice(0,100).map(model => ({ id: model.slug, name: typeof model.display_name === 'string' ? model.display_name.slice(0,100) : model.slug }));
    catalog = { token, checked: Date.now(), models }; return models;
  }
  function run(prompt, onText, { reasoning = 'low', model = MODEL, images = [] } = {}) {
    if (!['low', 'high'].includes(reasoning)) throw new Error('Choose Quick or Deep thinking.');
    const controller = new AbortController(); let cancelled = false, expired = false, text = '';
    const started = performance.now(), timings = {};
    const mark = name => { timings[name] ??= Math.round(performance.now() - started); };
    const timer = setTimeout(() => { expired = true; controller.abort(); }, timeout);
    const done = (async () => {
      try {
        const token = await auth.getToken(); controller.signal.throwIfAborted();
        if (!(await listModels(token, controller.signal)).some(item=>item.id===model)) throw providerError(400,'model_not_found'); mark('readyMs');
        const response = await fetcher('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, redirect: 'error', signal: controller.signal,
          body: JSON.stringify({ model, input: [{ role: 'user', content: images.length ? [{ type: 'input_text', text: prompt }, ...images.map(image_url=>({type:'input_image',image_url}))] : prompt }], reasoning: { effort: reasoning }, store: false, stream: true }) });
        if (!response.ok) { const data = await response.json().catch(() => ({})); throw providerError(response.status, data.error?.code); }
        // Some plan-backed responses omit Content-Type despite returning valid SSE.
        // Still reject an explicitly different format and validate every event below.
        const contentType = response.headers.get('content-type');
        if (!response.body || (contentType && !contentType.toLowerCase().includes('text/event-stream'))) {
          await response.body?.cancel().catch(() => {});
          throw new Error('ChatGPT returned an unreadable stream.');
        }
        mark('headersMs');
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', completed = false, sessionId = '';
        function event(frame) {
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data || data === '[DONE]') return;
          const value = JSON.parse(data);
          if (value.response?.model && value.response.model !== model) throw new Error('ChatGPT selected an unexpected model. This reply was stopped.');
          if (value.type === 'error' || ['response.failed', 'response.incomplete'].includes(value.type)) throw providerError(400, value.error?.code || value.response?.error?.code);
          if (value.type === 'response.output_item.added' && value.item?.type && !['message', 'reasoning'].includes(value.item.type)) throw new Error('ChatGPT attempted an unavailable action. This reply was stopped.');
          if (['response.output_text.delta', 'response.refusal.delta'].includes(value.type) && typeof value.delta === 'string') {
            if (completed) throw new Error('ChatGPT returned text after completing the reply.');
            text += value.delta; if (text.length > 64000) throw new Error('This reply exceeded the length limit. Ask for a shorter answer.');
            if (text.trim()) mark('firstTextMs'); onText(text);
          }
          if (value.type === 'response.completed') { completed = true; sessionId = value.response?.id || ''; mark('resultMs'); }
        }
        try {
          while (!completed) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, { stream: !chunk.done }); buffer = buffer.replace(/\r\n/g, '\n');
            if (buffer.length > 1000000) throw new Error('ChatGPT returned an oversized response.');
            let end; while ((end = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2); event(frame); }
            if (chunk.done) { if (buffer.trim()) event(buffer); break; }
          }
          if (!completed || !text.trim()) throw new Error('ChatGPT ended before completing a reply. Any partial text was saved.');
        } finally { await reader.cancel().catch(() => {}); }
        mark('closedMs'); return { text, sessionId, timings, provider: 'chatgpt-direct', reasoning, model };
      } catch (error) {
        if (cancelled) return { cancelled: true, text, timings, provider: 'chatgpt-direct', reasoning };
        if (expired) throw new Error('ChatGPT took too long to reply. Your message is saved; try again.');
        if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('The ChatGPT connection was interrupted. Any partial reply is saved.');
        throw error;
      } finally { clearTimeout(timer); }
    })();
    return { done, cancel: async () => { cancelled = true; controller.abort(); await done.catch(() => {}); } };
  }
  return { run, models: async()=>listModels(await auth.getToken(),AbortSignal.timeout(15000)), status: async () => ({ ...await auth.status(), model: MODEL, provider: 'chatgpt-direct' }) };
}
