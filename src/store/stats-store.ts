import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { dayKey, splitArtistNames, type Counter, type DayStats, type TrackMeta } from '@/lib/stats';
import type { Track } from '@/store/library-store';

type StatsState = {
  /** Agregado por dia (AAAA-MM-DD). Mês e ano são calculados somando os dias. */
  days: Record<string, DayStats>;
  /** Dados da faixa no momento em que foi ouvida (sobrevive se a faixa for apagada). */
  meta: Record<string, TrackMeta>;
  /** Ids das últimas faixas tocadas, mais recente primeiro. */
  recent: string[];
  record: (track: Track, ms: number, plays: number) => void;
  markRecent: (track: Track) => void;
  renameTrack: (track: Track) => void;
  renameArtist: (track: Track) => void;
  reset: () => void;
};

function addTo(map: Record<string, Counter>, key: string, ms: number, plays: number) {
  const entry = map[key] ?? { ms: 0, plays: 0 };
  map[key] = { ms: entry.ms + ms, plays: entry.plays + plays };
}

export const useStats = create<StatsState>()(
  persist(
    (set) => ({
      days: {},
      meta: {},
      recent: [],

      record: (track, ms, plays) => {
        const amount = Math.round(ms);
        if (amount <= 0 && plays <= 0) return;
        const key = dayKey();
        set((s) => {
          const previous = s.days[key] ?? { ms: 0, tracks: {}, artists: {} };
          const day: DayStats = {
            ms: previous.ms + amount,
            tracks: { ...previous.tracks },
            artists: { ...previous.artists },
          };
          addTo(day.tracks, track.id, amount, plays);
          for (const artist of splitArtistNames(track.artist)) addTo(day.artists, artist, amount, plays);
          return {
            days: { ...s.days, [key]: day },
            meta: {
              ...s.meta,
              [track.id]: { title: track.title, artist: track.artist, coverUrl: track.coverUrl },
            },
          };
        });
      },

      markRecent: (track) =>
        set((s) => ({ recent: [track.id, ...s.recent.filter((id) => id !== track.id)].slice(0, 20) })),

      renameTrack: (track) =>
        set((s) => ({
          meta: {
            ...s.meta,
            [track.id]: { title: track.title, artist: track.artist, coverUrl: track.coverUrl },
          },
        })),

      renameArtist: (track) => set((s) => {
        const meta = { ...s.meta, [track.id]: { title: track.title, artist: track.artist, coverUrl: track.coverUrl } };
        const days: Record<string, DayStats> = {};
        for (const [date, previous] of Object.entries(s.days)) {
          const artists: Record<string, Counter> = {};
          for (const [trackId, counter] of Object.entries(previous.tracks)) {
            const artistName = meta[trackId]?.artist ?? s.meta[trackId]?.artist;
            if (!artistName) continue;
            for (const artist of splitArtistNames(artistName)) addTo(artists, artist, counter.ms, counter.plays);
          }
          days[date] = { ...previous, artists };
        }
        return { meta, days };
      }),

      reset: () => set({ days: {}, meta: {}, recent: [] }),
    }),
    {
      name: '@spotylite/stats/v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ days: s.days, meta: s.meta, recent: s.recent }),
    }
  )
);
