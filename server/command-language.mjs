// Normalize only conversational framing. Never infer approval or change a target.
export function commandLanguage(message) {
  let text = message.trim().replace(/^(?:(?:hey|hello|okay|ok)[, ]+)?jarvis[,.:!]?\s+/i, '');
  text = text.replace(/^(?:(?:please|can you|could you|would you|will you|I want you to|I need you to|I would like you to|I'd like you to|I’d like you to)\s+)+/i, '');
  text = text.replace(/^remind me to\s+/i, 'add a task ')
    .replace(/^(?:put|add) (.+) (?:on|to) my (?:to-do|todo|task) list[.!]?$/i, 'add a task $1')
    .replace(/^jot down\s+/i, 'add a note ')
    .replace(/^keep a note of\s+/i, 'add a note ')
    .replace(/^(?:push back|reschedule|move) (?:the )?task\s+/i, 'update task ')
    .replace(/^I'm done with (?:the )?task\s+/i, 'complete task ')
    .replace(/^I’m done with (?:the )?task\s+/i, 'complete task ');
  return text;
}
