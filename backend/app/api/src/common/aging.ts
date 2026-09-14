import { daysBetween } from './dates';

export type AgingBucketKey = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';

export interface AgingBuckets {
  current: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  '90_plus': number;
}

export function emptyBuckets(): AgingBuckets {
  return {
    current: 0,
    '1_30': 0,
    '31_60': 0,
    '61_90': 0,
    '90_plus': 0,
  };
}

export function agingBucket(dueDate: string, asOfDate: string): AgingBucketKey {
  const days = daysBetween(dueDate, asOfDate);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}
