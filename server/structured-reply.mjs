export function parseObject(text) {
  if (typeof text !== 'string' || text.length > 40000) throw new Error('The model returned an unreadable result. Try again.');
  const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The model returned an unreadable result.');
  return value;
}
