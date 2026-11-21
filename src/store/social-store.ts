import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { buildTop, type TopEntry } from '@/lib/top';
import {
  ApiError,
  backendConfigured,
  db,
  getSession,
  loadSession,
  signIn as apiSignIn,
  signOut as apiSignOut,
  signUp as apiSignUp,
} from '@/services/supabase';
import { useStats } from '@/store/stats-store';

export type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  share_activity: boolean;
  total_ms: number;
  top_tracks: TopEntry[];
  top_artists: TopEntry[];
};

export type Presence = {
  user_id: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  cover_url: string | null;
  started_at: string | null;
  duration_ms: number | null;
  is_playing: boolean;
  updated_at: string;
};

export type Friend = { friendshipId: string; profile: PublicProfile; presence: Presence | null };
export type FriendRequest = { friendshipId: string; profile: PublicProfile };
export type SearchHit = Pick<PublicProfile, 'id' | 'username' | 'display_name'> & {
  relation: 'none' | 'friend' | 'sent' | 'received';
  friendshipId?: string;
};

const PROFILE_FIELDS = 'id,username,display_name,share_activity,total_ms,top_tracks,top_artists';
const PROFILE_CACHE = '@spotylite/profile/v1';

type SocialState = {
  ready: boolean;
  me: PublicProfile | null;
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  busy: boolean;
  init: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setShareActivity: (share: boolean) => Promise<void>;
  syncTop: () => Promise<void>;
  refreshFriends: () => Promise<void>;
  search: (term: string) => Promise<SearchHit[]>;
  sendRequest: (userId: string) => Promise<void>;
  accept: (friendshipId: string) => Promise<void>;
  remove: (friendshipId: string) => Promise<void>;
  loadProfile: (userId: string) => Promise<{ profile: PublicProfile; presence: Presence | null } | null>;
};

export const validUsername = (value: string) => /^[a-z0-9_]{3,20}$/.test(value);

export const useSocial = create<SocialState>()((set, get) => ({
  ready: false,
  me: null,
  friends: [],
  incoming: [],
  outgoing: [],
  busy: false,

  init: async () => {
    if (!backendConfigured) return set({ ready: true });
    const session = await loadSession();
    if (!session) return set({ ready: true, me: null });
    try {
      const cached = await AsyncStorage.getItem(PROFILE_CACHE);
      if (cached) set({ me: JSON.parse(cached) });
    } catch {
      /* ignora cache inválido */
    }
    set({ ready: true });
    try {
      const rows = await db.select<PublicProfile>('profiles', `id=eq.${session.userId}&select=${PROFILE_FIELDS}`);
      if (rows[0]) {
        set({ me: rows[0] });
        AsyncStorage.setItem(PROFILE_CACHE, JSON.stringify(rows[0])).catch(() => undefined);
      }
    } catch (error) {
      if (!getSession()) set({ me: null });
      else console.warn('Perfil indisponível agora.', error);
    }
    void get().refreshFriends();
    void get().syncTop();
  },

  signUp: async (username, password) => {
    if (get().busy) return; // toque duplo = duas tentativas seguidas = limite de requisições do servidor
    const name = username.trim().toLowerCase();
    if (!validUsername(name)) throw new Error('Use 3 a 20 caracteres: letras minúsculas, números e _.');
    if (password.length < 6) throw new Error('A senha precisa de pelo menos 6 caracteres.');
    set({ busy: true });
    try {
      await apiSignUp(name, password);
      await get().init();
    } finally {
      set({ busy: false });
    }
  },

  signIn: async (username, password) => {
    if (get().busy) return;
    const name = username.trim().toLowerCase();
    if (!name || !password) throw new Error('Informe usuário e senha.');
    set({ busy: true });
    try {
      await apiSignIn(name, password);
      await get().init();
    } finally {
      set({ busy: false });
    }
  },

  signOut: async () => {
    await apiSignOut();
    AsyncStorage.removeItem(PROFILE_CACHE).catch(() => undefined);
    set({ me: null, friends: [], incoming: [], outgoing: [] });
  },

  setShareActivity: async (share) => {
    const me = get().me;
    if (!me) return;
    set({ me: { ...me, share_activity: share } }); // otimista
    try {
      await db.update('profiles', `id=eq.${me.id}`, { share_activity: share, updated_at: new Date().toISOString() });
      if (!share) await db.remove('presence', `user_id=eq.${me.id}`);
    } catch (error) {
      set({ me });
      throw error;
    }
  },

  // Envia o ranking (apenas texto) para o perfil público.
  syncTop: async () => {
    const me = get().me;
    if (!me || !getSession()) return;
    const { days, meta } = useStats.getState();
    const top = buildTop(days, meta, 'time', 10);
    const total = Object.values(days).reduce((sum, d) => sum + d.ms, 0);
    try {
      await db.update('profiles', `id=eq.${me.id}`, {
        top_tracks: top.tracks,
        top_artists: top.artists,
        total_ms: Math.round(total),
        updated_at: new Date().toISOString(),
      });
      set({ me: { ...me, top_tracks: top.tracks, top_artists: top.artists, total_ms: Math.round(total) } });
    } catch (error) {
      console.warn('Não foi possível atualizar o perfil.', error);
    }
  },

  refreshFriends: async () => {
    const me = get().me;
    if (!me || !getSession()) return;
    try {
      const rows = await db.select<{ id: string; requester: string; addressee: string; status: 'pending' | 'accepted' }>(
        'friendships',
        'select=id,requester,addressee,status',
      );
      const otherId = (r: (typeof rows)[number]) => (r.requester === me.id ? r.addressee : r.requester);
      const ids = [...new Set(rows.map(otherId))];
      const profiles = ids.length
        ? await db.select<PublicProfile>('profiles', `id=in.(${ids.join(',')})&select=${PROFILE_FIELDS}`)
        : [];
      const byId = new Map(profiles.map((p) => [p.id, p]));

      const friendIds = rows.filter((r) => r.status === 'accepted').map(otherId);
      const presences = friendIds.length
        ? await db.select<Presence>('presence', `user_id=in.(${friendIds.join(',')})&select=*`)
        : [];
      const presenceById = new Map(presences.map((p) => [p.user_id, p]));

      const friends: Friend[] = [];
      const incoming: FriendRequest[] = [];
      const outgoing: FriendRequest[] = [];
      for (const row of rows) {
        const profile = byId.get(otherId(row));
        if (!profile) continue;
        if (row.status === 'accepted') friends.push({ friendshipId: row.id, profile, presence: presenceById.get(profile.id) ?? null });
        else if (row.addressee === me.id) incoming.push({ friendshipId: row.id, profile });
        else outgoing.push({ friendshipId: row.id, profile });
      }
      friends.sort((a, b) => a.profile.username.localeCompare(b.profile.username));
      set({ friends, incoming, outgoing });
    } catch (error) {
      console.warn('Não foi possível atualizar os amigos.', error);
    }
  },

  // Busca geral por nome de usuário (parte do nome, sem diferenciar maiúsculas).
  search: async (term) => {
    const me = get().me;
    const clean = term.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!me || clean.length < 2) return [];
    const rows = await db.select<Pick<PublicProfile, 'id' | 'username' | 'display_name'>>(
      'profiles',
      `username=ilike.*${clean}*&id=neq.${me.id}&select=id,username,display_name&order=username.asc&limit=25`,
    );
    const { friends, incoming, outgoing } = get();
    return rows.map((row): SearchHit => {
      const friend = friends.find((f) => f.profile.id === row.id);
      if (friend) return { ...row, relation: 'friend', friendshipId: friend.friendshipId };
      const received = incoming.find((r) => r.profile.id === row.id);
      if (received) return { ...row, relation: 'received', friendshipId: received.friendshipId };
      const sent = outgoing.find((r) => r.profile.id === row.id);
      if (sent) return { ...row, relation: 'sent', friendshipId: sent.friendshipId };
      return { ...row, relation: 'none' };
    });
  },

  sendRequest: async (userId) => {
    const me = get().me;
    if (!me) return;
    // Se a outra pessoa já tinha pedido, aceitar é o mesmo que pedir de volta.
    const received = get().incoming.find((r) => r.profile.id === userId);
    if (received) return get().accept(received.friendshipId);
    try {
      await db.insert('friendships', { requester: me.id, addressee: userId, status: 'pending' });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) return get().refreshFriends();
      throw error;
    }
    await get().refreshFriends();
  },

  accept: async (friendshipId) => {
    await db.update('friendships', `id=eq.${friendshipId}`, { status: 'accepted' });
    await get().refreshFriends();
  },

  remove: async (friendshipId) => {
    await db.remove('friendships', `id=eq.${friendshipId}`);
    await get().refreshFriends();
  },

  loadProfile: async (userId) => {
    const rows = await db.select<PublicProfile>('profiles', `id=eq.${userId}&select=${PROFILE_FIELDS}`);
    if (!rows[0]) return null;
    let presence: Presence | null = null;
    try {
      const p = await db.select<Presence>('presence', `user_id=eq.${userId}&select=*`);
      presence = p[0] ?? null;
    } catch {
      presence = null;
    }
    return { profile: rows[0], presence };
  },
}));

/** A presença só vale se estiver tocando e a faixa ainda não tiver terminado. */
export function activePresence(presence: Presence | null | undefined): Presence | null {
  if (!presence || !presence.is_playing || !presence.title || !presence.started_at) return null;
  const started = Date.parse(presence.started_at);
  const duration = presence.duration_ms && presence.duration_ms > 0 ? presence.duration_ms : 15 * 60_000;
  return Date.now() <= started + duration + 30_000 ? presence : null;
}
