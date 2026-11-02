// Injected only by tests, never selectable from a production HTTP request.
export function fixtureHermes() {
  return {
    status: async () => ({ state: 'ready', message: 'Test connection is ready.', model: 'gpt-5.6-luna', provider: 'openai-codex' }),
    run(prompt, onText) {
      const result = text => ({ done: Promise.resolve({ text: typeof text === 'string' ? text : JSON.stringify(text) }), cancel: async () => {} });
      if (prompt.startsWith('JARVIS_EVERGREEN_INTENT:')) {
        const data = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        return result({ kind: 'write', type: /JPY/.test(data.message) ? 'purchase.create' : 'task.create', domain: /JPY/.test(data.message) ? 'expenses' : 'tasks', input: {}, target: '', clarification: '' });
      }
      if (prompt.startsWith('JARVIS_EVERGREEN_ACTION:')) {
        const source = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        if (source.tentative.type === 'purchase.create') return result({ type: 'purchase.create', input: { currency: 'JPY', date: '2026-10-06', items: [{ name: 'Synthetic yen item', category: 'Other', amountMinor: 10000, split: 'personal', shares: [] }] }, targetId: '', clarification: '' });
        return result({ type: 'task.create', input: { title: /Friday/i.test(source.userRequest) ? 'Browser Friday lecture' : 'Browser lecture', date: /Friday/i.test(source.userRequest) ? '2026-10-09' : '2026-10-07', priority: 'Medium' }, targetId: '', clarification: '' });
      }
      if (prompt.startsWith('Classify WhatsApp messages')) {
        const source = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        return result({ items: source.messages.map(m => ({ id: m.id, important: m.body !== 'Old context', summary: 'Alex is asking about dinner on Friday.', reminder: '', dueText: '' })) });
      }
      if (prompt.startsWith('JARVIS_WHATSAPP_INTENT:')) {
        const { userRequest, choices } = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        return result(/(?:read|hear)/i.test(userRequest) ? { action: 'read', targetRef: choices[0]?.ref || 'recent' } : /reply/i.test(userRequest) ? { action: 'prepare', targetRef: 'recent' } : { action: 'digest' });
      }
      if (prompt.startsWith('JARVIS_WHATSAPP_BRIEFING:')) {
        const source = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        return result({ groups: source.chats.map(g => ({ ref: g.ref, update: 'Alex is checking whether you can join dinner on Friday.', suggestion: 'You could confirm the time before committing.', memoryRefs: [], invitation: true })) });
      }
      if (prompt.startsWith('JARVIS_WHATSAPP_DRAFT:')) return result('Sounds good, let me check and confirm!');
      if (prompt.startsWith('JARVIS_MEMORY:')) {
        const source = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        const content = source.content || source.context.at(-1)?.user || '';
        return { done: Promise.resolve({ text: JSON.stringify({ kind: 'note', title: 'Coffee preference', relationship: '', aliases: [], content, evidence: [content] }) }), cancel: async () => {} };
      }
      if (prompt.startsWith('JARVIS_CAPTURE:')) {
        const { content } = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        const text = JSON.stringify({ title: content.replace(/ tomorrow$/i, ''), dueDate: '', dateText: '', sourceUrl: '' });
        return { done: Promise.resolve({ text }), cancel: async () => {} };
      }
      if (prompt.startsWith('JARVIS_RECORD_COMMAND:')) {
        const { message } = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1));
        let plan;
        if (message.startsWith('Create a project ')) plan = { action: 'create', kind: 'project', target: '', patch: { title: message.slice(17), body: 'A synthetic test project.' } };
        else if (message === 'Rename project Voice garden to Voice orchard') plan = { action: 'update', kind: 'project', target: 'Voice garden', patch: { title: 'Voice orchard' } };
        else if (message === 'Delete project Voice orchard') plan = { action: 'delete', kind: 'project', target: 'Voice orchard' };
        else plan = { action: 'unsupported', target: '' };
        return { done: Promise.resolve({ text: JSON.stringify(plan) }), cancel: async () => {} };
      }
      const request = JSON.parse(prompt.slice(prompt.indexOf('{"recentConversation"')));
      let settle; let timer; const reply = request.userRequest.includes('TEST_TALK') ? 'Let us make a simple plan. Take one small step today.' : request.selectedSources.length ? `A useful next step from ${request.selectedSources[0].title}: make a short checklist.` : `Here is a thoughtful reply to: ${request.userRequest}`;
      const done = new Promise((resolve, reject) => {
        settle = resolve;
        onText(request.userRequest.includes('TEST_TALK') ? 'Let us make a simple plan. ' : 'Thinking about your request.');
        timer = setTimeout(() => {
          if (request.userRequest.includes('TEST_ERROR')) reject(new Error('Test provider is temporarily unavailable. Your message is saved.'));
          else { onText(reply); resolve({ text: reply, sessionId: 'fixture-session' }); }
        }, request.userRequest.includes('TEST_SLOW') ? 10000 : 450);
      });
      return { done, cancel: async () => { clearTimeout(timer); settle({ cancelled: true, text: 'Thinking about your request.' }); } };
    },
  };
}
