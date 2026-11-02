export function voiceGreeting(date = new Date(), addressAs = 'sir') {
  const hour = date.getHours();
  const time = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${time}${addressAs ? `, ${addressAs}` : ''}. What shall we work on?`;
}
