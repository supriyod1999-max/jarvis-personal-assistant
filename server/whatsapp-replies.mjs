// Only provider metadata is evidence of a sent reply; message text is never authority.
export function replyMetadata(row) {
  return { status: typeof row.status === 'string' ? row.status : 'unknown',
    replyTo: typeof row.metadata?.quotedMessage?.id === 'string' ? row.metadata.quotedMessage.id.slice(0, 250) : '' };
}
export function sentReply(message) {
  return message.fromMe && message.id && ['sent', 'delivered', 'read', 'played'].includes(message.status)
    && !['reaction', 'revoked', 'protocol', 'notification'].includes(message.type)
    && (message.body?.trim() || ['audio', 'ptt', 'voice', 'image', 'video', 'document', 'sticker', 'location', 'contact'].includes(message.type));
}
