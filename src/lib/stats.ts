export type Period = 'day' | 'month' | 'year';

export type Counter = { ms: number; plays: number };
export type DayStats = {
  ms: number;
  tracks: Record<string, Counter>;
  artists: Record<string, Counter>;
};
export type TrackMeta = { title: string; artist: string; coverUrl: string | null };
export type Ranked = { key: string; ms: number; plays: number };
export type Summary = {
  totalMs: number;
  plays: number;
  tracks: Ranked[];
  artists: Ranked[];
};

const pad = (n: number) => String(n).padStart(2, '0');

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Chave AAAA-MM-DD no fuso local. */
export function dayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function periodKey(date: Date, period: Period): string {
  const key = dayKey(date);
  if (period === 'day') return key;
  return period === 'month' ? key.slice(0, 7) : key.slice(0, 4);
}

export function shiftPeriod(date: Date, period: Period, delta: number): Date {
  const next = new Date(date);
  if (period === 'day') {
    next.setDate(next.getDate() + delta);
  } else if (period === 'month') {
    next.setDate(1);
    next.setMonth(next.getMonth() + delta);
  } else {
    next.setDate(1);
    next.setFullYear(next.getFullYear() + delta);
  }
  return next;
}

export function periodLabel(date: Date, period: Period): string {
  const now = new Date();
  if (period === 'year') return String(date.getFullYear());
  if (period === 'month') {
    const name = MONTHS[date.getMonth()];
    return `${name[0].toUpperCase()}${name.slice(1)} de ${date.getFullYear()}`;
  }
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Hoje';
  if (key === dayKey(shiftPeriod(now, 'day', -1))) return 'Ontem';
  return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

function bump(map: Record<string, Counter>, key: string, ms: number, plays: number) {
  const entry = map[key] ?? { ms: 0, plays: 0 };
  entry.ms += ms;
  entry.plays += plays;
  map[key] = entry;
}

export function splitArtistNames(artist: string): string[] {
  const commaSeparated = artist.split(',');
  const names = commaSeparated.flatMap((name, index) =>
    commaSeparated.length > 1 && index === commaSeparated.length - 1 ? name.split(/\s+e\s+/i) : [name]
  );
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))];
}

/** Soma todos os dias que começam com a chave do período (dia, mês ou ano). */
export function summarize(days: Record<string, DayStats>, key: string): Summary {
  const tracks: Record<string, Counter> = {};
  const artists: Record<string, Counter> = {};
  let totalMs = 0;
  let plays = 0;

  for (const [day, stats] of Object.entries(days)) {
    if (!day.startsWith(key)) continue;
    totalMs += stats.ms;
    for (const [id, c] of Object.entries(stats.tracks)) {
      bump(tracks, id, c.ms, c.plays);
      plays += c.plays;
    }
    for (const [name, c] of Object.entries(stats.artists)) {
      for (const artist of splitArtistNames(name)) bump(artists, artist, c.ms, c.plays);
    }
  }

  const toList = (map: Record<string, Counter>): Ranked[] =>
    Object.entries(map).map(([k, c]) => ({ key: k, ms: c.ms, plays: c.plays }));
  return { totalMs, plays, tracks: toList(tracks), artists: toList(artists) };
}

export type RankBy = 'time' | 'plays';

export function rank(list: Ranked[], by: RankBy, limit = 10): Ranked[] {
  const score = (r: Ranked) => (by === 'time' ? r.ms : r.plays);
  return [...list]
    .filter((r) => score(r) > 0)
    .sort((a, b) => score(b) - score(a) || b.ms - a.ms)
    .slice(0, limit);
}

export function totalAllTime(days: Record<string, DayStats>): number {
  let total = 0;
  for (const stats of Object.values(days)) total += stats.ms;
  return total;
}
