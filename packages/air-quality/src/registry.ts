import { US_EPA_2024 } from './standards/us-epa-2024.js';
import type { Standard } from './types.js';

export const DEFAULT_STANDARD_ID = 'us-epa-2024';

/** Add a regional norm by creating `standards/<id>.ts` and registering it here. */
export const STANDARDS: Record<string, Standard> = {
  [US_EPA_2024.id]: US_EPA_2024,
};

export function getStandard(id: string = DEFAULT_STANDARD_ID): Standard {
  return STANDARDS[id] ?? STANDARDS[DEFAULT_STANDARD_ID]!;
}
