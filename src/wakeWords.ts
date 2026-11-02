export function wakeCommand(text: string): string | null {
  const match = text.trim().match(/^(?:hey|hello|wake\s+up)[,\s]+jarvis(?:[.!?,:;]+|\s|$)\s*(.*)$/i);
  return match ? match[1].trim() : null;
}
export function sleepCommand(text: string) {
  return /^(?:(?:hey |hello )?jarvis[, ]+)?(?:go to sleep|sleep now|dismiss|that's all|that is all)[.!]?$/i.test(text.trim());
}
export function microphoneOffCommand(text: string) { return /^(?:(?:hey |hello )?jarvis[, ]+)?(?:stop listening|turn off (?:the )?(?:microphone|wake listening)|microphone off)[.!]?$/i.test(text.trim()); }
