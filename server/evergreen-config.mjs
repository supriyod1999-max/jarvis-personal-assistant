import { join } from 'node:path';
import { createEvergreenClient } from './evergreen-client.mjs';
import { evergreenSyntheticSession } from './evergreen-transport.mjs';
import { preparedEvergreenHouseholdRegistry } from './evergreen-household-production.mjs';

// Normal bootstrap mounts the production boundary with no release evidence.
// Validation fails BEFORE construction of its HTTPS transport or any vault I/O.
// Direct application construction stays held. Normal host bootstrap can supply
// the separately reviewed server-only file loader; HTTP cannot install it.
export const heldEvergreenMemberRegistry = options => preparedEvergreenHouseholdRegistry({ ...options, release: null });

export function configuredEvergreen({ directory, profileId, mode = 'disabled', port = 4320 }) {
  if (!['disabled', 'synthetic'].includes(mode)) throw new Error('Evergreen live mode is unavailable pending coordinated release.');
  // Separate disk namespace even if the development server uses an existing
  // workspace directory. Synthetic proof can never be loaded as a live grant.
  return createEvergreenClient({ directory: join(directory, mode === 'synthetic' ? 'synthetic-evergreen' : 'live-evergreen'), profileId,
    ...(mode === 'synthetic' ? evergreenSyntheticSession({ port }) : {}) });
}
