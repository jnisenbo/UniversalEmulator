import type { Graphics } from '@shared/settings';

/** Labels shared by Settings → Graphics and the per-game graphics menu. */
export const ASPECTS: Graphics['aspect'][] = ['auto', '16:9', '4:3', 'stretch'];
export const ASPECT_LABEL: Record<Graphics['aspect'], string> = { auto: 'Auto', '16:9': '16:9', '4:3': '4:3', stretch: 'Stretch' };
/** Index = resolution scale. */
export const RES_LABEL = ['', 'Native', '2×', '3×', '4×'] as const;
