// Display-only summary of the current authenticated connection. No grants,
// account selectors, record contents or automatic pairing/network retry.
export function evergreenHealth(status) {
  if (['release-held', 'owner-only'].includes(status?.state)) return { state: 'held', detail: 'Your household connection is waiting for its reviewed release and signed-in consent.' };
  if (status?.synthetic) return { state: 'partial', detail: 'Synthetic Evergreen test connection. No live household access.' };
  if (status?.state === 'denied') return { state: 'needs_attention', detail: 'Evergreen access was denied or revoked. Review your household connection in Settings.' };
  if (status?.state === 'suspended' || status?.problem) return { state: 'needs_attention', detail: 'Evergreen access needs attention. Check the connection in Settings; no action was automatically retried.' };
  if (status?.privacy?.processWithAI !== true) return { state: 'needs_attention', detail: 'Review your Evergreen data-processing choices in Settings before connecting.' };
  if (status?.pairing) return { state: 'needs_attention', detail: 'Finish the signed-in Evergreen approval and original pairing exchange in Settings.' };
  if (status?.state === 'connected' && status?.connection && status?.liveEnabled === true) return { state: 'ready', detail: 'Your approved Evergreen household connection is available. Access follows its selected permissions.' };
  if (status?.connection) return { state: 'needs_attention', detail: 'Evergreen is paired, but current live access is not verified. Check the connection in Settings.' };
  return { state: 'not_connected', detail: 'The household connector is installed. Complete your signed-in Evergreen pairing in Settings.' };
}
