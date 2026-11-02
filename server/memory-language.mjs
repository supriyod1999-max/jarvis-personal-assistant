// These cues start a proposal, never a write. Approval remains an exact user
// reply to a particular unexpired review in this conversation.
export function memoryIntent(message) {
  const text = message.trim();
  const polite = '(?:(?:please|can you|could you|would you|will you|I want you to|I need you to|I would like you to|I[’\x27]d like you to|make sure you|you should)\\s+)*';
  const verb = '(?:remember\\b|keep (?:this|that|it) in mind\\b|keep in mind\\b|make (?:a )?note\\b|take (?:a )?note\\b|save (?:this|that|it)(?: as (?:a )?memory)?\\b|don[’\x27]t forget\\b|do not forget\\b|for future reference\\b)';
  const start = new RegExp('^' + polite + verb, 'i');
  const match = text.match(start);
  if (match) {
    let content = text.slice(match[0].length).replace(/^[\s,:;.!?-]*(?:that\s+|this\s*:?\s*)?/i, '').trim();
    if (/\bnote$/i.test(match[0])) content = content.replace(/^of\s+/i, '');
    if (/^(?:who|what|where|when|how|whether)\b/i.test(content) && /^(?:can|could|would|will) you remember/i.test(text)) return null;
    if (/^(?:this|that|it|this for (?:next time|later)|that for (?:next time|later)|for (?:next time|later|the future)|what I (?:just )?(?:said|told you))[.!?]?$/i.test(content)) content = '';
    return { content, contextual: !content };
  }
  const tail = /[,.!;]\s*(?:(?:please|can you|could you|I want you to)\s+)?(?:remember (?:this|that|it)|keep (?:this|that|it) in mind|save (?:this|that|it)(?: for (?:later|next time))?|make a note of (?:this|that|it)|don[’']t forget (?:this|that|it))[.!?]?$/i.exec(text);
  return tail ? { content: text.slice(0, tail.index).trim(), contextual: false } : null;
}
export const simpleYes = text => /^(?:yes(?: please|[, ]+save (?:it|that|this)|[, ]+remember (?:it|that|this))?|yeah|yep|correct|that[’']s (?:right|correct)|go ahead(?: and save (?:it|that))?|save (?:it|that|this)|confirm)[.!]?$/i.test(text.trim());
export const simpleNo = text => /^(?:no(?: thanks|[, ]+don[’']t save (?:it|that))?|nope|not now|never mind|nevermind|don[’']t save (?:it|that|this))[.!]?$/i.test(text.trim());
export const memoryCorrection = text => /^(?:no[,;:]?\s+|actually[,;:]?\s+|I (?:meant|mean)\b|correction\b|that[’']s (?:wrong|not right)\b|it[’']s\b|her\b|his\b|the correct\b)/i.test(text.trim());
export function memoryContext(turns) {
  const selected = []; let length = 0;
  for (const turn of turns.filter(t => t.status === 'complete').slice(-8).reverse()) {
    const item = { user: turn.message.slice(0, 8000), assistant: turn.reply.slice(0, 8000) };
    if (length + JSON.stringify(item).length > 18000) break;
    selected.unshift(item); length += JSON.stringify(item).length;
  }
  return selected;
}
