export function wavBase64(blocks: Float32Array[]) {
  const length = Math.min(480000, blocks.reduce((sum, block) => sum + block.length, 0));
  const bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const word = (offset: number, text: string) => [...text].forEach((character, i) => bytes[offset + i] = character.charCodeAt(0));
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, length * 2, true);
  let index = 0; for (const block of blocks) for (const sample of block) {
    if (index >= length) break;
    view.setInt16(44 + index++ * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  }
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function speechText(text: string) {
  return text.replace(/```[\s\S]*?(?:```|$)/g, ' Code is in the written reply. ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*#`_>]/g, '').trimStart();
}
export function nextSpeech(text: string, final: boolean, first = false) {
  const limit = first ? 140 : 220;
  const sentence = /[.!?](?=\s|$)/.exec(text);
  let length = sentence && sentence.index < limit ? sentence.index + 1 : 0;
  // Start long opening sentences at a natural clause boundary when possible.
  if (!length && first && text.length >= 70) {
    const clause = /[,;:](?=\s)/g; let match;
    while ((match = clause.exec(text)) && match.index < limit) if (match.index >= 45) { length = match.index + 1; break; }
  }
  if (!length && text.length > limit) { const space = text.lastIndexOf(' ', limit); length = space > 0 ? space : limit; }
  if (!length && final) length = Math.min(limit, text.length);
  return length;
}
