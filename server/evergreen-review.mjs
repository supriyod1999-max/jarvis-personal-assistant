const label = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
const currencies = new Set(['AUD', 'INR', 'USD', 'EUR', 'GBP', 'NZD', 'CAD', 'SGD', 'JPY']);
function currencyContext(value, inherited = {}) {
  if (typeof inherited === 'string') inherited = { currency: inherited, original: inherited };
  return {
    currency: value.currency || value.nativeCurrency || inherited.currency,
    original: value.originalCurrency || value.currency || inherited.original,
    household: value.householdCurrency || inherited.household,
  };
}
function money(minor, currency) {
  if (!Number.isSafeInteger(minor) || !currencies.has(currency)) throw new Error('The Evergreen amount cannot be reviewed without its supported currency and minor-unit scale.');
  const digits = currency === 'JPY' ? 0 : 2;
  return `${currency} ${new Intl.NumberFormat('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 10 ** digits)}`;
}
export function describeEvergreen(value, ownerUid, inherited = {}) {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value !== 'object') return String(value === ownerUid ? 'you' : value);
  if (Array.isArray(value)) return value.map(v => describeEvergreen(v, ownerUid, inherited)).join('; ') || 'none';
  const context = currencyContext(value, inherited);
  const attributionWarning = value.integrationAttribution?.calculationReady === false
    ? 'This legacy record has unverified payer or split attribution. Do not use it to calculate what anyone owes. ' : '';
  return attributionWarning + (Object.entries(value).filter(([key, v]) => v !== '' && !['id', 'recordId', 'source', 'createdAt', 'updatedAt', 'version', 'schemaVersion'].includes(key)).map(([key, v]) => {
    if (/Minor$/.test(key)) {
      const currency = /^aud/i.test(key) ? 'AUD' : /^original/i.test(key) ? context.original : /^household/i.test(key) ? context.household : context.currency || context.original || context.household;
      return `${label(key.replace(/Minor$/, ''))}: ${money(v, currency)}`;
    }
    return `${label(key)}: ${describeEvergreen(v, ownerUid, context)}`;
  }).join('. ') || 'no details');
}
export function evergreenReview(p) {
  const summary = p.summary, context = currencyContext(summary.input);
  const changes = summary.changes.map(c => `${c.domain}: ${c.before === null ? 'Add' : c.after === null ? 'Remove' : 'Change'} ${c.before === null ? describeEvergreen(c.after, p.memberUid, context) : c.after === null ? describeEvergreen(c.before, p.memberUid, context) : `from ${describeEvergreen(c.before, p.memberUid, context)} to ${describeEvergreen(c.after, p.memberUid, context)}`}.`).join('\n');
  return `Here’s your Evergreen review. ${summary.warning || ''}\n${describeEvergreen(summary.input, p.memberUid, context)}.\n${changes}\n${['purchase.create', 'repayment.record'].includes(summary.type) ? 'This records a ledger entry only; no payment or bank transfer will be executed. ' : ''}Say “confirm Evergreen change” to approve this exact review, or tell me what to correct.`;
}
