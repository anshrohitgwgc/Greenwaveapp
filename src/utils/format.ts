import { format, formatDistanceToNowStrict, isToday, isTomorrow, isYesterday, parseISO } from 'date-fns';

export function formatWeight(kg: number): string {
  if (kg >= 1000) return `${(kg / 1000).toFixed(2)} t`;
  if (kg === 0) return '0 kg';
  return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
}

export function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), 'h:mm a');
  } catch {
    return '';
  }
}

export function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'EEE d MMM');
  } catch {
    return '';
  }
}

/** "Today · 8:00 AM" / "Tue 3 Sep · 2:00 PM" */
export function formatDayTime(iso: string): string {
  try {
    const date = parseISO(iso);
    const time = format(date, 'h:mm a');
    if (isToday(date)) return `Today · ${time}`;
    if (isTomorrow(date)) return `Tomorrow · ${time}`;
    if (isYesterday(date)) return `Yesterday · ${time}`;
    return `${format(date, 'EEE d MMM')} · ${time}`;
  } catch {
    return iso;
  }
}

export function formatRelative(iso: string): string {
  try {
    return `${formatDistanceToNowStrict(parseISO(iso))} ago`;
  } catch {
    return '';
  }
}

/** Minutes -> "8h 30m" */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Live elapsed time since an ISO instant, as "2h 14m". */
export function elapsedSince(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return formatDuration(minutes);
}

/**
 * Start and end of a local calendar day, as UTC ISO instants.
 *
 * Job times are stored in UTC, but "today" means the driver's local day.
 * Filtering on a bare date string would slice the wrong 24 hours in
 * Vancouver (UTC-7/-8), so always send instants.
 */
export function localDayRange(date: Date = new Date()): { fromIso: string; toIso: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

/** Local midnight N days ago, as a UTC ISO instant. */
export function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

/** YYYY-MM-DD in the device's local timezone. */
export function toDateKey(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Combines a YYYY-MM-DD and a HH:mm into a local-time ISO string. */
export function toIso(dateKey: string, time: string): string {
  const [hours = '9', minutes = '0'] = time.split(':');
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(
    year ?? new Date().getFullYear(),
    (month ?? 1) - 1,
    day ?? 1,
    Number.parseInt(hours, 10) || 0,
    Number.parseInt(minutes, 10) || 0,
    0,
    0,
  );
  return date.toISOString();
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Parses a user-typed weight, tolerating commas and stray units. */
export function parseWeight(input: string): number | null {
  const cleaned = input.replace(/,/g, '.').replace(/[^\d.]/g, '');
  if (cleaned === '') return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}
