import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createDeferredStorage } from '@/lib/deferred-storage';

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string | null;
  durationMs: number;
  /** Identificador estável do conteúdo importado, usado para evitar duplicatas. */
  sourceUrl: string;
  /** Nome do arquivo dentro da pasta local de músicas; null = arquivo ausente. */
  fileName: string | null;
  addedAt: number;
};

export type TrackGroup = { id: string; name: string; trackIds: string[] };

export type Playlist = {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  sourceUrl: string | null;
  trackIds: string[];
  groups: TrackGroup[];
  createdAt: number;
  updatedAt: number;
};

export type NewTrack = Pick<Track, 'title' | 'artist' | 'album' | 'coverUrl' | 'durationMs' | 'sourceUrl'>;

export type TrackPatch = Partial<Pick<Track, 'fileName' | 'coverUrl' | 'durationMs'>>;

/** Faixa que acabou de ser baixada: metadados + arquivo + playlist de destino (opcional). */
export type DownloadedTrack = { input: NewTrack; fileName: string; playlistId: string | null };

type LibraryState = {
  tracks: Track[];
  playlists: Playlist[];
  upsertTracks: (inputs: NewTrack[]) => Track[];
  renameTrack: (trackId: string, title: string) => void;
  renameTracksBulk: (changes: { id: string; after: string }[]) => Track[];
  renameArtist: (trackId: string, artist: string) => void;
  createTrackGroup: (playlistId: string, name: string, trackIds: string[]) => void;
  renameTrackGroup: (playlistId: string, groupId: string, name: string) => void;
  deleteTrackGroup: (playlistId: string, groupId: string) => void;
  setTrackCover: (trackId: string, coverUrl: string | null) => void;
  setTrackFile: (trackId: string, fileName: string | null) => void;
  setTrackDuration: (trackId: string, durationMs: number) => void;
  removeTrack: (trackId: string) => void;
  /** Aplica vários ajustes de faixas em uma única atualização. */
  patchTracks: (patches: Record<string, TrackPatch>) => void;
  /** Registra várias faixas baixadas (cria/atualiza + arquivo + playlist) em UMA atualização. */
  registerDownloads: (items: DownloadedTrack[]) => Track[];
  /** Exclusão em lote da biblioteca (também sai de todas as playlists). */
  removeTracks: (trackIds: string[]) => void;
  /** Remove várias faixas de uma playlist (elas continuam na biblioteca). */
  removeTracksFromPlaylist: (playlistId: string, trackIds: string[]) => void;
  /** Adiciona as mesmas faixas a várias playlists de uma vez. Devolve quantas inclusões novas foram feitas. */
  addTracksToPlaylists: (playlistIds: string[], trackIds: string[]) => number;
  createPlaylist: (input: { name: string; description?: string; coverUrl?: string | null; sourceUrl?: string | null }) => Playlist;
  renamePlaylist: (playlistId: string, name: string) => void;
  setPlaylistCover: (playlistId: string, coverUrl: string | null) => void;
  addTracksToPlaylist: (playlistId: string, trackIds: string[]) => void;
  moveTrackInPlaylist: (playlistId: string, fromIndex: number, toIndex: number) => void;
  reorderPlaylistTracks: (playlistId: string, trackIds: string[]) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  deletePlaylist: (playlistId: string) => void;
};

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Tira faixas removidas dos grupos; grupos com menos de 2 faixas deixam de existir. */
function pruneGroups(groups: TrackGroup[] | undefined, removed: ReadonlySet<string>): TrackGroup[] {
  return (groups ?? [])
    .map((g) => ({ ...g, trackIds: g.trackIds.filter((id) => !removed.has(id)) }))
    .filter((g) => g.trackIds.length > 1);
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      tracks: [],
      playlists: [],

      // Músicas com a mesma URL de origem são guardadas uma única vez
      // e podem pertencer a várias playlists.
      upsertTracks: (inputs) => {
        const known = new Map<string, Track>(get().tracks.map((t): [string, Track] => [t.sourceUrl, t]));
        const created: Track[] = [];
        const result: Track[] = [];
        const now = Date.now();
        for (const input of inputs) {
          let track = known.get(input.sourceUrl);
          if (!track) {
            track = { ...input, id: makeId('t'), fileName: null, addedAt: now };
            known.set(input.sourceUrl, track);
            created.push(track);
          }
          result.push(track);
        }
        if (created.length > 0) set((s) => ({ tracks: [...s.tracks, ...created] }));
        return result;
      },

      renameArtist: (trackId, artist) => {
        const cleanArtist = artist.trim();
        if (!cleanArtist) throw new Error('Digite um nome para o artista.');
        set((s) => ({ tracks: s.tracks.map((track) => track.id === trackId ? { ...track, artist: cleanArtist } : track) }));
      },

      createTrackGroup: (playlistId, name, trackIds) => {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Digite um nome para o grupo.');
        if (trackIds.length < 2) throw new Error('Selecione pelo menos duas músicas.');
        set((s) => ({ playlists: s.playlists.map((p) => {
          if (p.id !== playlistId) return p;
          const validIds = p.trackIds.filter((id) => trackIds.includes(id));
          const groups = (p.groups ?? []).filter((g) => !g.trackIds.some((id) => validIds.includes(id)));
          return { ...p, groups: [...groups, { id: makeId('g'), name: cleanName, trackIds: validIds }], updatedAt: Date.now() };
        }) }));
      },

      renameTrackGroup: (playlistId, groupId, name) => {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Digite um nome para o grupo.');
        set((s) => ({ playlists: s.playlists.map((p) => p.id === playlistId ? { ...p, groups: (p.groups ?? []).map((g) => g.id === groupId ? { ...g, name: cleanName } : g), updatedAt: Date.now() } : p) }));
      },

      deleteTrackGroup: (playlistId, groupId) => set((s) => ({ playlists: s.playlists.map((p) => p.id === playlistId ? { ...p, groups: (p.groups ?? []).filter((g) => g.id !== groupId), updatedAt: Date.now() } : p) })),

      renameTrack: (trackId, title) => {
        const cleanTitle = title.trim();
        if (!cleanTitle) throw new Error('Digite um nome para a música.');
        set((s) => ({ tracks: s.tracks.map((track) => track.id === trackId ? { ...track, title: cleanTitle } : track) }));
      },

      renameTracksBulk: (changes) => {
        const byId = new Map(changes.map((c) => [c.id, c.after.trim()]));
        const updated: Track[] = [];
        set((s) => ({
          tracks: s.tracks.map((track) => {
            const title = byId.get(track.id);
            if (!title) return track;
            const next = { ...track, title };
            updated.push(next);
            return next;
          }),
        }));
        return updated;
      },

      setTrackCover: (trackId, coverUrl) =>
        set((s) => ({ tracks: s.tracks.map((track) => track.id === trackId ? { ...track, coverUrl } : track) })),

      setTrackFile: (trackId, fileName) =>
        set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, fileName } : t)) })),

      setTrackDuration: (trackId, durationMs) =>
        set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, durationMs } : t)) })),

      removeTrack: (trackId) => get().removeTracks([trackId]),

      patchTracks: (patches) => {
        if (Object.keys(patches).length === 0) return;
        set((s) => ({ tracks: s.tracks.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)) }));
      },

      registerDownloads: (items) => {
        const result: Track[] = [];
        if (items.length === 0) return result;
        set((s) => {
          const bySource = new Map<string, Track>(s.tracks.map((t): [string, Track] => [t.sourceUrl, t]));
          const updatedById = new Map<string, Track>();
          const created: Track[] = [];
          const additions = new Map<string, string[]>();
          const now = Date.now();

          for (const { input, fileName, playlistId } of items) {
            let track = bySource.get(input.sourceUrl);
            if (!track) {
              track = { ...input, id: makeId('t'), fileName, addedAt: now };
              created.push(track);
            } else if (track.fileName !== fileName && !created.some((c) => c.id === track!.id)) {
              track = { ...track, fileName };
              updatedById.set(track.id, track);
            }
            bySource.set(input.sourceUrl, track);
            result.push(track);
            if (playlistId) {
              const list = additions.get(playlistId) ?? [];
              list.push(track.id);
              additions.set(playlistId, list);
            }
          }

          const tracks = updatedById.size > 0 ? s.tracks.map((t) => updatedById.get(t.id) ?? t) : s.tracks;
          const playlists = additions.size > 0
            ? s.playlists.map((p) => {
                const ids = additions.get(p.id);
                return ids ? { ...p, trackIds: unique([...p.trackIds, ...ids]), updatedAt: now } : p;
              })
            : s.playlists;
          return { tracks: created.length > 0 ? [...tracks, ...created] : tracks, playlists };
        });
        return result;
      },

      removeTracks: (trackIds) => {
        if (trackIds.length === 0) return;
        const removed = new Set(trackIds);
        const now = Date.now();
        set((s) => ({
          tracks: s.tracks.filter((t) => !removed.has(t.id)),
          playlists: s.playlists.map((p) =>
            p.trackIds.some((id) => removed.has(id))
              ? { ...p, trackIds: p.trackIds.filter((id) => !removed.has(id)), groups: pruneGroups(p.groups, removed), updatedAt: now }
              : p
          ),
        }));
      },

      removeTracksFromPlaylist: (playlistId, trackIds) => {
        if (trackIds.length === 0) return;
        const removed = new Set(trackIds);
        const now = Date.now();
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, trackIds: p.trackIds.filter((id) => !removed.has(id)), groups: pruneGroups(p.groups, removed), updatedAt: now }
              : p
          ),
        }));
      },

      addTracksToPlaylists: (playlistIds, trackIds) => {
        if (playlistIds.length === 0 || trackIds.length === 0) return 0;
        const targets = new Set(playlistIds);
        const now = Date.now();
        let added = 0;
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (!targets.has(p.id)) return p;
            const have = new Set(p.trackIds);
            const fresh = unique(trackIds).filter((id) => !have.has(id));
            if (fresh.length === 0) return p;
            added += fresh.length;
            return { ...p, trackIds: [...p.trackIds, ...fresh], updatedAt: now };
          }),
        }));
        return added;
      },

      createPlaylist: ({ name, description = '', coverUrl = null, sourceUrl = null }) => {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Digite um nome para a playlist.');
        // Reimportar o mesmo link de playlist reaproveita a playlist existente.
        if (sourceUrl) {
          const existing = get().playlists.find((p) => p.sourceUrl === sourceUrl);
          if (existing) return existing;
        }
        const now = Date.now();
        const playlist: Playlist = {
          id: makeId('p'),
          name: cleanName,
          description,
          coverUrl,
          sourceUrl,
          trackIds: [],
          groups: [],
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ playlists: [playlist, ...s.playlists] }));
        return playlist;
      },

      renamePlaylist: (playlistId, name) => {
        const cleanName = name.trim();
        if (!cleanName) throw new Error('Digite um nome para a playlist.');
        set((s) => ({
          playlists: s.playlists.map((playlist) => playlist.id === playlistId
            ? { ...playlist, name: cleanName, updatedAt: Date.now() }
            : playlist),
        }));
      },

      setPlaylistCover: (playlistId, coverUrl) =>
        set((s) => ({
          playlists: s.playlists.map((playlist) => playlist.id === playlistId
            ? { ...playlist, coverUrl, updatedAt: Date.now() }
            : playlist),
        })),

      addTracksToPlaylist: (playlistId, trackIds) =>
        set((s) => ({
          playlists: s.playlists.map((p) =>
            p.id === playlistId
              ? { ...p, trackIds: unique([...p.trackIds, ...trackIds]), updatedAt: Date.now() }
              : p
          ),
        })),

      moveTrackInPlaylist: (playlistId, fromIndex, toIndex) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== playlistId || fromIndex < 0 || toIndex < 0 || fromIndex >= p.trackIds.length || toIndex >= p.trackIds.length) return p;
            const trackIds = [...p.trackIds];
            const [trackId] = trackIds.splice(fromIndex, 1);
            trackIds.splice(toIndex, 0, trackId);
            return { ...p, trackIds, updatedAt: Date.now() };
          }),
        })),

      reorderPlaylistTracks: (playlistId, orderedTrackIds) =>
        set((s) => ({
          playlists: s.playlists.map((p) => {
            if (p.id !== playlistId) return p;
            const currentIds = p.trackIds;
            const allowed = new Set(currentIds);
            const reordered = orderedTrackIds.filter((trackId) => allowed.has(trackId));
            const seen = new Set(reordered);
            for (const trackId of currentIds) if (!seen.has(trackId)) reordered.push(trackId);
            if (reordered.length !== currentIds.length || reordered.every((trackId, index) => trackId === currentIds[index])) return p;
            return { ...p, trackIds: reordered, updatedAt: Date.now() };
          }),
        })),

      removeTrackFromPlaylist: (playlistId, trackId) => get().removeTracksFromPlaylist(playlistId, [trackId]),

      deletePlaylist: (playlistId) =>
        set((s) => ({ playlists: s.playlists.filter((p) => p.id !== playlistId) })),
    }),
    {
      name: '@spotylite/library/v2',
      storage: createDeferredStorage<{ tracks: Track[]; playlists: Playlist[] }>(1000),
      partialize: (s) => ({ tracks: s.tracks, playlists: s.playlists }),
      onRehydrateStorage: () => (state) => { if (state) state.playlists = state.playlists.map((p) => ({ ...p, groups: p.groups ?? [] })); },
    }
  )
);
