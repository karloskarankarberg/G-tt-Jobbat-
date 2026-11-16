import { PeriodPreset } from '../types/timeTracking';

const sekFormatter = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  maximumFractionDigits: 0,
});

const sekExactFormatter = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const hoursFormatter = new Intl.NumberFormat('sv-SE', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatSEK(amount: number): string {
  return sekFormatter.format(Math.round(amount));
}

export function formatSEKExact(amount: number): string {
  return sekExactFormatter.format(amount);
}

export function formatHours(hours: number): string {
  return `${hoursFormatter.format(hours)} tim`;
}

export function formatHoursPlain(hours: number): string {
  return hoursFormatter.format(hours);
}

export function formatHoursAndMinutes(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} tim`;
  return `${h} tim ${m} min`;
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

export function relativeIsoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return toIsoDate(d);
}

export function formatSwedishDate(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dt);
}

export function formatSwedishDateFull(isoDate: string): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(dt);
}

export function getMonthKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const dt = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat('sv-SE', {
    month: 'long',
    year: 'numeric',
  }).format(dt);
}

export function getPeriodBounds(
  preset: PeriodPreset,
  customStart?: string,
  customEnd?: string
): { startDate: string; endDate: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case 'this_month': {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return {
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
        label: formatMonthLabel(getMonthKey(now)),
      };
    }
    case 'last_month': {
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);
      return {
        startDate: toIsoDate(start),
        endDate: toIsoDate(end),
        label: formatMonthLabel(getMonthKey(start)),
      };
    }
    case 'this_week': {
      const d = new Date(now);
      const dayOfWeek = d.getDay(); // 0=Sun, 1=Mon
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(d);
      monday.setDate(d.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return {
        startDate: toIsoDate(monday),
        endDate: toIsoDate(sunday),
        label: `Vecka (${toIsoDate(monday)} – ${toIsoDate(sunday)})`,
      };
    }
    case 'this_year': {
      return {
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        label: `Helår ${year}`,
      };
    }
    case 'custom': {
      const start = customStart || '';
      const end = customEnd || '';
      const label =
        start && end
          ? `${start} – ${end}`
          : start
            ? `Från ${start}`
            : end
              ? `Till ${end}`
              : 'All registrerad tid';
      return {
        startDate: start,
        endDate: end,
        label,
      };
    }
    case 'all':
    default:
      return {
        startDate: '',
        endDate: '',
        label: 'All registrerad tid',
      };
  }
}

export function calculateHoursFromTimes(start: string, end: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (endMin <= startMin) return null;
  const rawHours = (endMin - startMin) / 60;
  return Math.min(24, Math.max(0.25, Math.round(rawHours * 4) / 4));
}

export const QUARTER_HOUR_TIMES: string[] = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

export const QUARTER_HOUR_END_TIMES: string[] = [...QUARTER_HOUR_TIMES, '24:00'];

export function formatStopwatch(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
