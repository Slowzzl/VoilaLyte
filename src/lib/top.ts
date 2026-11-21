import { rank, summarize, type DayStats, type TrackMeta } from '@/lib/stats';

export type TopEntry = { name: string; sub: string; ms: number; plays: number };

/** Músicas e artistas mais tocados (todo o histórico), só com texto — é o que vai para o perfil público. */
export function buildTop(
  days: Record<string, DayStats>,
  meta: Record<string, TrackMeta>,
  by: 'time' | 'plays' = 'time',
  limit = 10,
): { tracks: TopEntry[]; artists: TopEntry[] } {
  const summary = summarize(days, '');
  const tracks = rank(summary.tracks, by, limit).map((r) => ({
    name: meta[r.key]?.title ?? 'Faixa removida',
    sub: meta[r.key]?.artist ?? '',
    ms: Math.round(r.ms),
    plays: r.plays,
  }));
  const artists = rank(summary.artists, by, limit).map((r) => ({
    name: r.key,
    sub: '',
    ms: Math.round(r.ms),
    plays: r.plays,
  }));
  return { tracks, artists };
}
