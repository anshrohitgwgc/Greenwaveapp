/**
 * GreenWave design tokens.
 *
 * Deliberately light-only and high-contrast: drivers use this outdoors on a
 * phone in daylight. Colours come from the GreenWave mark (deep navy + leaf
 * green + wave blue).
 */

import { Platform } from 'react-native';
import type { JobStatus, JobType } from '@/api/types';

export const colors = {
  // Brand
  navy: '#0B3B5A',
  navyDeep: '#07293E',
  green: '#1F9D55',
  greenDark: '#15803D',
  greenSoft: '#E7F6EC',
  wave: '#1E7FB8',
  waveSoft: '#E6F1F9',

  // Neutrals
  ink: '#101828',
  body: '#475467',
  muted: '#98A2B3',
  line: '#E4E7EC',
  lineStrong: '#D0D5DD',
  surface: '#FFFFFF',
  canvas: '#F7F9FA',

  // Status
  amber: '#B54708',
  amberSoft: '#FEF0C7',
  red: '#B42318',
  redSoft: '#FEE4E2',
  blue: '#175CD3',
  blueSoft: '#D1E9FF',
  slate: '#475467',
  slateSoft: '#EAECF0',

  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, fontWeight: '600' as const },
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.3 },
  mono: {
    fontSize: 14,
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    }),
  },
} as const;

export const shadow = Platform.select({
  ios: {
    shadowColor: '#101828',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: { elevation: 2 },
  default: {
    boxShadow: '0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)',
  },
}) as object;

/** Widest the content column gets on desktop web. */
export const CONTENT_MAX_WIDTH = 880;

// --- status presentation ----------------------------------------------------

export const statusMeta: Record<
  JobStatus,
  { label: string; fg: string; bg: string }
> = {
  scheduled: { label: 'Scheduled', fg: colors.slate, bg: colors.slateSoft },
  assigned: { label: 'Assigned', fg: colors.blue, bg: colors.blueSoft },
  in_progress: { label: 'In progress', fg: colors.amber, bg: colors.amberSoft },
  completed: { label: 'Completed', fg: colors.greenDark, bg: colors.greenSoft },
  cancelled: { label: 'Cancelled', fg: colors.red, bg: colors.redSoft },
};

export const typeMeta: Record<JobType, { label: string; icon: string; tint: string }> = {
  pickup: { label: 'Pickup', icon: 'arrow-up-circle', tint: colors.green },
  dropoff: { label: 'Dropoff', icon: 'arrow-down-circle', tint: colors.wave },
};
