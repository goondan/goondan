import { format, isValid, parseISO } from 'date-fns';

export function formatTimestamp(iso: string): string {
  if (!iso) return '-';
  const date = parseISO(iso);
  return isValid(date) ? format(date, 'yyyy-MM-dd HH:mm:ss') : iso;
}

export function formatTime(iso: string): string {
  if (!iso) return '-';
  const date = parseISO(iso);
  return isValid(date) ? format(date, 'HH:mm:ss') : iso;
}
