const normal = value => String(value || '').toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const confirmsWhatsAppSend = value => /^(?:yes[, ]+)?(?:please[, ]+)?(?:send it|send (?:the|that) message|go ahead(?: and)? send it)(?:,? please)?$/i.test(normal(value));
export const repeatsWhatsAppReview = value => /^(?:please )?(?:repeat (?:that|the review|the message)|read (?:it|that|the message) (?:back|again))$/i.test(normal(value));

function literal(value) {
  const text = value.trim();
  return /^(["“]).*["”]$/s.test(text) ? text.slice(1, -1).trim() : text;
}
// Only deterministic, explicit dictation. Anything uncertain still goes through Luna.
// This parser never returns a send action and never examines incoming message text.
export function fastWhatsAppIntent(message, previous, available) {
  const input = message.trim().replace(/^(?:hey |hello )?jarvis[, ]+/i, '').replace(/^please\s+/i, '');
  const accountAnswer = available.find(a => normal(a.name) === normal(input.replace(/^use\s+/i, '')));
  if (accountAnswer && previous?.intent) return { ...previous.intent, account: accountAnswer.name, targetRef: '' };
  if (previous?.kind === 'send' && previous.target) {
    const correction = input.match(/^(?:no[, ]+)?(?:change (?:it|that|the message|that message) to|make it|instead say)\s+([\s\S]+)$/i);
    if (correction) return { action: 'prepare', targetRef: 'recent', text: literal(correction[1]) };
  }
  const current = previous?.target ? 'recent' : previous?.groups?.length === 1 ? previous.groups[0].ref : '';
  if (current && /^(?:help me reply|suggest (?:a |the )?reply|draft (?:a |the )?reply|what should I say|reply for me)(?: (?:in my usual style|like I usually would))?[.!?]?$/i.test(input)) return { action: 'prepare', targetRef: current, instruction: input };
  const reply = input.match(/^reply(?:\s+(?:saying|with))?\s*:\s*([\s\S]+)$/i) || input.match(/^reply\s+(?:saying|with|that)\s+([\s\S]+)$/i);
  if (current && reply) return { action: 'prepare', targetRef: current, text: literal(reply[1]) };

  const match = input.match(/^(?:whatsapp\s+)?(?:message|text|send (?:a |a whatsapp )?message to|reply to)\s+(.+?)\s+(?:saying|that says)\s+([\s\S]+)$/i)
    || input.match(/^(?:whatsapp\s+)?(?:message|text|reply to)\s+([^:\n]+):\s*([\s\S]+)$/i);
  if (!match) return null;
  let contact = match[1].trim(), account = '';
  for (const candidate of [...available].sort((a, b) => b.name.length - a.name.length)) {
    const suffix = new RegExp(`\\s+(?:on|from|using|via)\\s+${escape(candidate.name)}$`, 'i');
    if (suffix.test(contact)) { contact = contact.replace(suffix, '').trim(); account = candidate.name; break; }
  }
  // Don't silently turn an unknown account choice or multi-recipient request into a name.
  if (!contact || /\b(?:on|from|using|via|and|or)\b|[,;\n]/i.test(contact)) return null;
  return { action: 'prepare', account, contact, text: literal(match[2]) };
}
