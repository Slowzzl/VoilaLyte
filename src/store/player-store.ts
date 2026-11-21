import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, requestNotificationPermissionsAsync, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { playableUri } from '@/services/files';
import { useLibrary, type Track, type TrackGroup } from '@/store/library-store';
import { useStats } from '@/store/stats-store';

export type RepeatMode = 'off' | 'all' | 'one';

type PlaybackSession = {
  trackId: string;
  order: string[];
  index: number;
  positionMs: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  groups?: TrackGroup[];
};

const PAUSED_NOTIFICATION_TTL_MS = 10 * 60_000;
const PLAYBACK_SESSION_KEY = '@spotylite/player-session/v1';

type PlayerState = {
  current: Track | null;
  isPlaying: boolean;
  expanded: boolean;
  error: string | null;
  /** Ordem de reprodução atual (já embaralhada, se for o caso). */
  order: Track[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
  play: (track: Track, list?: Track[], groups?: TrackGroup[]) => void;
  playList: (list: Track[], options?: { shuffle?: boolean; groups?: TrackGroup[] }) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (ms: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  playQueueIndex: (queueIndex: number) => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  renameTrack: (track: Track) => void;
  /** Tira faixas excluídas da fila; se a faixa atual foi excluída, a reprodução para. */
  removeTracks: (trackIds: string[]) => void;
  setExpanded: (expanded: boolean) => void;
  clearError: () => void;
};

/** Posição/duração ficam num store à parte para não re-renderizar a tela inteira a cada 500 ms. */
export const useProgress = create<{ positionMs: number; durationMs: number }>()(() => ({
  positionMs: 0,
  durationMs: 0,
}));

// ---------------------------------------------------------------------------
// Player nativo (único, independente de qualquer conta ou serviço externo)
// ---------------------------------------------------------------------------

let player: AudioPlayer | null = null;
let source: Track[] = []; // lista na ordem original
let playbackGroups: TrackGroup[] = [];
let notificationPermission: Promise<void> | null = null;
let audioModeReady: Promise<boolean> = Promise.resolve(false);
let lastSessionSaveAt = 0;
let sessionSaveQueue = Promise.resolve();
let sessionRestore: Promise<void> | null = null;
let finishedTrackId: string | null = null;
/** Evita criar um segundo MediaSession nativo ("Session ID must be unique"). */
let lockScreenActive = false;

function clearLockScreen() {
  lockScreenActive = false;
  try {
    player?.clearLockScreenControls();
  } catch {
    /* o player pode já ter sido liberado */
  }
}

function audioMetadata(track: Track) {
  return {
    title: track.title,
    artist: track.artist || 'Artista desconhecido',
    albumTitle: track.album || 'Spotylite',
    artworkUrl: track.coverUrl ?? undefined,
  };
}

/**
 * Pede a permissão de notificações uma única vez e devolve sempre a MESMA promessa.
 * Antes, só a primeira chamada esperava a resposta: a segunda (troca rápida de faixa) criava a sessão de mídia
 * sem permissão e a notificação não aparecia nem depois de o usuário aceitar.
 */
function ensureNotificationPermission(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  notificationPermission ??= requestNotificationPermissionsAsync()
    .then((permission) => {
      if (!permission.granted) {
        console.warn('Permissão de notificações negada; os controles podem não aparecer na gaveta de notificações.');
      }
    })
    .catch((error) => console.warn('Não foi possível solicitar permissão para notificações.', error));
  return notificationPermission;
}

async function activateLockScreenControls(track: Track) {
  try {
    if (!(await audioModeReady)) return;
    await ensureNotificationPermission();
    if (usePlayer.getState().current?.id !== track.id) return;
    const audio = ensurePlayer();
    if (lockScreenActive) {
      audio.updateLockScreenMetadata(audioMetadata(track));
    } else {
      lockScreenActive = true; // marca ANTES de qualquer chamada concorrente
      audio.setActiveForLockScreen(true, audioMetadata(track), {
        showSeekBackward: true,
        showSeekForward: true,
        seekBackwardIntervalSeconds: 10,
        seekForwardIntervalSeconds: 30,
      });
    }
  } catch (error) {
    lockScreenActive = false; // senão a próxima tentativa só "atualizaria" uma sessão que nunca existiu
    console.warn('Não foi possível ativar os controles de reprodução.', error);
  }
}

export function updateLockScreenMetadata(track: Track) {
  if (usePlayer.getState().current?.id !== track.id || !player) return;
  try {
    player.updateLockScreenMetadata(audioMetadata(track));
  } catch (error) {
    console.warn('Não foi possível atualizar os metadados da tela de bloqueio.', error);
  }
}

function ensurePlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { updateInterval: 500 });
    player.addListener('playbackStatusUpdate', onStatus);
  }
  return player;
}

function waitForPlayerLoad(audio: AudioPlayer): Promise<boolean> {
  if (audio.isLoaded) return Promise.resolve(true);

  return new Promise((resolve) => {
    let subscription: { remove: () => void } | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      resolve(loaded);
    };

    timeout = setTimeout(() => finish(audio.isLoaded), 10_000);
    subscription = audio.addListener('playbackStatusUpdate', (status) => {
      if (status.isLoaded) finish(true);
      else if (status.error) finish(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Contagem de tempo ouvido
// ---------------------------------------------------------------------------

const listen = {
  lastPos: null as number | null, // segundos
  pendingMs: 0,
  sessionMs: 0,
  pendingPlay: false,
  counted: false,
  durationSynced: false,
};

function resetListening() {
  listen.lastPos = null;
  listen.pendingMs = 0;
  listen.sessionMs = 0;
  listen.pendingPlay = false;
  listen.counted = false;
  listen.durationSynced = false;
}

/** Grava no histórico o tempo acumulado da faixa atual. */
export function flushListening() {
  const current = usePlayer.getState().current;
  if (current && (listen.pendingMs > 0 || listen.pendingPlay)) {
    useStats.getState().record(current, listen.pendingMs, listen.pendingPlay ? 1 : 0);
  }
  listen.pendingMs = 0;
  listen.pendingPlay = false;
}

function trackListening(positionSec: number, playing: boolean) {
  const current = usePlayer.getState().current;
  if (!current) return;
  if (playing && listen.lastPos !== null) {
    // Mede o avanço real da posição: pulos (seek) zeram lastPos e não contam.
    const deltaMs = (positionSec - listen.lastPos) * 1000;
    if (deltaMs > 0 && deltaMs <= 30_000) {
      listen.pendingMs += deltaMs;
      listen.sessionMs += deltaMs;
    }
  }
  listen.lastPos = positionSec;

  // Conta como reprodução após 30 s ouvidos (ou metade, em faixas curtas), igual aos serviços de streaming.
  if (!listen.counted) {
    const duration = current.durationMs > 0 ? current.durationMs : 60_000;
    if (listen.sessionMs >= Math.min(30_000, duration / 2)) {
      listen.counted = true;
      listen.pendingPlay = true;
    }
  }
  if (listen.pendingMs >= 15_000 || (listen.pendingPlay && listen.pendingMs > 0)) flushListening();
}

// ---------------------------------------------------------------------------
// Eventos do player
// ---------------------------------------------------------------------------

type StatusLike = {
  currentTime: number;
  duration: number;
  playing: boolean;
  isLoaded?: boolean;
  didJustFinish?: boolean;
  error?: unknown;
};

function onStatus(raw: unknown) {
  const status = raw as StatusLike;
  const state = usePlayer.getState();
  if (!state.current) return;

  const durationMs = status.duration > 0 ? status.duration * 1000 : state.current.durationMs;
  useProgress.setState({ positionMs: status.currentTime * 1000, durationMs });

  // Aprende a duração real na primeira vez que a faixa toca.
  if (status.duration > 0 && !listen.durationSynced) {
    listen.durationSynced = true;
    if (Math.abs(state.current.durationMs - durationMs) > 1500) {
      useLibrary.getState().setTrackDuration(state.current.id, Math.round(durationMs));
    }
  }

  if (status.error) {
    usePlayer.setState({ error: 'Não foi possível reproduzir esta faixa.', isPlaying: false });
    clearLockScreen();
    savePlaybackSession(true);
    return;
  }
  if (status.isLoaded !== false && status.playing !== state.isPlaying) {
    usePlayer.setState({ isPlaying: status.playing });
  }

  trackListening(status.currentTime, status.playing);
  if (!status.playing) flushListening();
  savePlaybackSession();

  if (status.didJustFinish && finishedTrackId !== state.current.id) {
    finishedTrackId = state.current.id;
    flushListening();
    handleEnded();
  }
}

function handleEnded() {
  const { repeat, order, index } = usePlayer.getState();
  if (repeat === 'one') {
    finishedTrackId = null;
    listen.lastPos = null;
    listen.sessionMs = 0;
    listen.counted = false;
    void ensurePlayer().seekTo(0);
    ensurePlayer().play();
    return;
  }
  if (index + 1 < order.length || repeat === 'all') {
    startAt((index + 1) % Math.max(order.length, 1));
    return;
  }
  // Fim da fila
  ensurePlayer().pause();
  clearLockScreen();
  void ensurePlayer().seekTo(0);
  useProgress.setState({ positionMs: 0 });
  usePlayer.setState({ isPlaying: false });
  savePlaybackSession(true);
}

function shuffled<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildOrder(list: Track[], first: Track | null, shuffle: boolean, groups: TrackGroup[] = []): { order: Track[]; index: number } {
  const valid = groups.map((group) => ({ ...group, trackIds: group.trackIds.filter((id) => list.some((track) => track.id === id)) })).filter((group) => group.trackIds.length > 1);
  const groupByTrack = new Map<string, TrackGroup>();
  valid.forEach((group) => group.trackIds.forEach((id) => groupByTrack.set(id, group)));
  const blocks: Track[][] = [];
  const consumed = new Set<string>();
  for (const track of list) {
    if (consumed.has(track.id)) continue;
    const group = groupByTrack.get(track.id);
    if (group) {
      const members = group.trackIds.map((id) => list.find((item) => item.id === id)).filter((item): item is Track => !!item);
      if (members.length > 1) { blocks.push(members); members.forEach((item) => consumed.add(item.id)); continue; }
    }
    blocks.push([track]); consumed.add(track.id);
  }
  let orderedBlocks = blocks;
  if (shuffle) {
    const firstBlock = first ? blocks.find((block) => block.some((track) => track.id === first.id)) : undefined;
    const rest = shuffled(blocks.filter((block) => block !== firstBlock));
    orderedBlocks = firstBlock ? [firstBlock, ...rest] : rest;
  }
  let order = orderedBlocks.flat();
  if (first) {
    const block = orderedBlocks.find((items) => items.some((track) => track.id === first.id));
    if (block && block[0].id !== first.id) {
      // A grouped track always starts its group; selecting a member starts at that member but keeps its followers adjacent.
      const at = order.findIndex((track) => track.id === first.id);
      order = [...order.slice(0, at), ...order.slice(at)];
    }
  }
  const index = first ? Math.max(0, order.findIndex((track) => track.id === first.id)) : 0;
  return { order, index };
}

function startAt(index: number) {
  const { order } = usePlayer.getState();
  const queued = order[index];
  if (!queued) return;
  finishedTrackId = null;

  flushListening();
  resetListening();

  // Usa a versão mais recente da faixa (pode ter sido baixada depois de entrar na fila).
  const track = useLibrary.getState().tracks.find((t) => t.id === queued.id) ?? queued;

  usePlayer.setState({ current: track, index, error: null, isPlaying: true });
  useProgress.setState({ positionMs: 0, durationMs: track.durationMs });
  savePlaybackSession(true);
  useStats.getState().markRecent(track);

  try {
    const p = ensurePlayer();
    p.replace(playableUri(track));
    p.play();
    void activateLockScreenControls(track);
  } catch {
    usePlayer.setState({ isPlaying: false, error: 'Não foi possível reproduzir esta faixa.' });
  }
}

// ---------------------------------------------------------------------------
// Store público
// ---------------------------------------------------------------------------

export const usePlayer = create<PlayerState>()((set, get) => ({
  current: null,
  isPlaying: false,
  expanded: false,
  error: null,
  order: [],
  index: 0,
  shuffle: false,
  repeat: 'off',

  play: (track, list, groups) => {
    source = list && list.some((t) => t.id === track.id) ? list : [track];
    playbackGroups = groups ?? [];
    const { order, index } = buildOrder(source, track, get().shuffle, playbackGroups);
    set({ order });
    startAt(index);
  },

  playList: (list, options) => {
    if (list.length === 0) return;
    const shuffle = options?.shuffle ?? get().shuffle;
    source = list;
    playbackGroups = options?.groups ?? [];
    const built = buildOrder(list, null, shuffle, playbackGroups);
    set({ order: built.order, shuffle });
    startAt(0);
  },

  toggle: () => {
    const { current, isPlaying } = get();
    if (!current) return;
    const p = ensurePlayer();
    if (isPlaying) {
      p.pause();
      set({ isPlaying: false });
      flushListening();
      savePlaybackSession(true);
      return;
    }
    const { positionMs, durationMs } = useProgress.getState();
    if (durationMs > 0 && positionMs >= durationMs - 300) {
      void p.seekTo(0);
      listen.lastPos = null;
    }
    finishedTrackId = null;
    p.play();
    set({ isPlaying: true, error: null });
    // A notificação some quando o fim da fila a limpa ou depois de muito tempo pausado: sempre reativa ao tocar.
    void activateLockScreenControls(current);
    savePlaybackSession(true);
  },

  next: () => {
    const { order, index, repeat } = get();
    if (order.length === 0) return;
    if (index + 1 < order.length) startAt(index + 1);
    else if (repeat === 'all') startAt(0);
  },

  prev: () => {
    const { order, index } = get();
    if (order.length === 0) return;
    if (useProgress.getState().positionMs > 3000 || index === 0) {
      void ensurePlayer().seekTo(0);
      listen.lastPos = null;
      useProgress.setState({ positionMs: 0 });
      return;
    }
    startAt(index - 1);
  },

  seek: (ms) => {
    listen.lastPos = null;
    useProgress.setState({ positionMs: ms });
    void ensurePlayer().seekTo(ms / 1000);
    savePlaybackSession(true);
  },

  toggleShuffle: () => {
    const { shuffle, current } = get();
    const next = !shuffle;
    const built = buildOrder(source, current, next, playbackGroups);
    set({ shuffle: next, order: built.order, index: built.index });
    savePlaybackSession(true);
  },

  cycleRepeat: () => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    set((s) => ({ repeat: modes[(modes.indexOf(s.repeat) + 1) % modes.length] }));
    savePlaybackSession(true);
  },

  addToQueue: (track) => {
    const { order } = get();
    if (order.length === 0) {
      get().play(track, [track]);
      return;
    }
    source = [...source, track];
    set({ order: [...order, track] });
    savePlaybackSession(true);
  },

  playNext: (track) => {
    const { order, index } = get();
    if (order.length === 0) {
      get().play(track, [track]);
      return;
    }
    const nextOrder = [...order.slice(0, index + 1), track, ...order.slice(index + 1)];
    source = [...source, track];
    set({ order: nextOrder });
    savePlaybackSession(true);
  },

  playQueueIndex: (queueIndex) => {
    const { order, index } = get();
    if (queueIndex === index || queueIndex < 0 || queueIndex >= order.length) return;
    startAt(queueIndex);
  },

  moveInQueue: (fromIndex, toIndex) => {
    const { order, index } = get();
    if (fromIndex <= index || toIndex <= index || fromIndex >= order.length || toIndex >= order.length) return;
    const nextOrder = [...order];
    const moving = nextOrder[fromIndex];
    const group = playbackGroups.find((item) => item.trackIds.includes(moving.id));
    const blockIds = group ? group.trackIds.filter((id) => order.findIndex((item) => item.id === id) > index) : [moving.id];
    const block = nextOrder.filter((item) => blockIds.includes(item.id));
    const remaining = nextOrder.filter((item) => !blockIds.includes(item.id));
    const target = nextOrder[toIndex];
    const targetGroup = playbackGroups.find((item) => item.trackIds.includes(target.id));
    if (group && targetGroup?.id === group.id) return;
    const targetIds = targetGroup ? targetGroup.trackIds.filter((id) => order.findIndex((item) => item.id === id) > index) : [target.id];
    const targetFirst = remaining.findIndex((item) => targetIds.includes(item.id));
    const insertAt = targetFirst < 0 ? remaining.length : targetFirst + (toIndex > fromIndex ? targetIds.length : 0);
    remaining.splice(insertAt, 0, ...block);
    source = remaining;
    set({ order: remaining });
    savePlaybackSession(true);
  },

  renameTrack: (track) => {
    const replaceTrack = (item: Track) => item.id === track.id ? track : item;
    source = source.map(replaceTrack);
    set((state) => ({
      current: state.current?.id === track.id ? track : state.current,
      order: state.order.map(replaceTrack),
    }));
  },

  removeTracks: (trackIds) => {
    if (trackIds.length === 0) return;
    const gone = new Set(trackIds);
    source = source.filter((item) => !gone.has(item.id));
    playbackGroups = playbackGroups
      .map((group) => ({ ...group, trackIds: group.trackIds.filter((id) => !gone.has(id)) }))
      .filter((group) => group.trackIds.length > 1);

    const { current, order } = get();
    const nextOrder = order.filter((item) => !gone.has(item.id));
    if (current && gone.has(current.id)) {
      flushListening();
      resetListening();
      try {
        player?.pause();
      } catch {
        /* o player pode já ter sido liberado */
      }
      clearLockScreen();
      set({ current: null, isPlaying: false, expanded: false, order: nextOrder, index: 0 });
      useProgress.setState({ positionMs: 0, durationMs: 0 });
      void AsyncStorage.removeItem(PLAYBACK_SESSION_KEY);
      return;
    }
    set({ order: nextOrder, index: current ? Math.max(0, nextOrder.findIndex((item) => item.id === current.id)) : 0 });
    savePlaybackSession(true);
  },

  setExpanded: (expanded) => set({ expanded }),
  clearError: () => set({ error: null }),
}));

function savePlaybackSession(force = false) {
  const now = Date.now();
  if (!force && now - lastSessionSaveAt < 3000) return;
  lastSessionSaveAt = now;

  const state = usePlayer.getState();
  if (!state.current) return;
  const progress = useProgress.getState();
  const session: PlaybackSession = {
    trackId: state.current.id,
    order: state.order.map((track) => track.id),
    index: state.index,
    positionMs: Math.max(0, Math.round(progress.positionMs)),
    isPlaying: state.isPlaying,
    shuffle: state.shuffle,
    repeat: state.repeat,
    groups: playbackGroups,
  };

  sessionSaveQueue = sessionSaveQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(session)))
    .catch((error: unknown) => console.warn('Não foi possível salvar a sessão de reprodução.', error));
}

async function restorePlaybackSession() {
  await useLibrary.persist.rehydrate();
  const serialized = await AsyncStorage.getItem(PLAYBACK_SESSION_KEY);
  if (!serialized) return;

  try {
    const saved = JSON.parse(serialized) as Partial<PlaybackSession>;
    if (typeof saved.trackId !== 'string') throw new Error('Sessão inválida.');
    if (usePlayer.getState().current) return;

    const tracks = useLibrary.getState().tracks;
    const byId = new Map(tracks.map((track) => [track.id, track]));
    const current = byId.get(saved.trackId);
    if (!current) {
      await AsyncStorage.removeItem(PLAYBACK_SESSION_KEY);
      return;
    }

    const order = (Array.isArray(saved.order) ? saved.order : [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => byId.get(id))
      .filter((track): track is Track => track !== undefined);
    let index = Number.isInteger(saved.index) ? Math.max(0, Math.min(Number(saved.index), order.length)) : 0;
    if (order[index]?.id !== current.id) {
      const currentIndex = order.findIndex((track) => track.id === current.id);
      if (currentIndex >= 0) index = currentIndex;
      else order.splice(index, 0, current);
    }

    const positionMs = Number.isFinite(saved.positionMs) ? Math.max(0, Number(saved.positionMs)) : 0;
    const repeat: RepeatMode = saved.repeat === 'all' || saved.repeat === 'one' ? saved.repeat : 'off';
    const shouldResume = saved.isPlaying === true;
    source = order;
    playbackGroups = Array.isArray(saved.groups) ? saved.groups : [];
    resetListening();
    usePlayer.setState({
      current,
      isPlaying: false,
      expanded: false,
      error: null,
      order,
      index,
      shuffle: saved.shuffle === true,
      repeat,
    });
    useProgress.setState({ positionMs, durationMs: current.durationMs });

    await audioModeReady;
    const audio = ensurePlayer();
    audio.replace(playableUri(current));
    if (positionMs > 0) {
      if (!(await waitForPlayerLoad(audio))) {
        usePlayer.setState({ error: 'Não foi possível preparar a retomada da música.' });
        return;
      }
      const durationMs = audio.duration > 0 ? audio.duration * 1000 : current.durationMs;
      const resumePositionMs = durationMs > 0 ? Math.min(positionMs, Math.max(0, durationMs - 500)) : positionMs;
      await audio.seekTo(resumePositionMs / 1000);
    }
    if (shouldResume) {
      audio.play();
      usePlayer.setState({ isPlaying: true });
      void activateLockScreenControls(current);
    }
    savePlaybackSession(true);
  } catch (error) {
    console.warn('Não foi possível restaurar a sessão de reprodução.', error);
    await AsyncStorage.removeItem(PLAYBACK_SESSION_KEY);
  }
}

/** Configura o áudio (tocar com o celular no silencioso e em segundo plano). Chame uma vez no layout raiz. */
export function initPlayer(): () => void {
  audioModeReady = setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  }).then(() => true).catch((error) => {
    console.warn('Não foi possível configurar o áudio em segundo plano.', error);
    return false;
  });
  ensurePlayer();
  void ensureNotificationPermission(); // pede já na abertura, não no meio da primeira música
  sessionRestore ??= restorePlaybackSession().catch((error) => {
    console.warn('Não foi possível carregar a sessão de reprodução.', error);
  });

  const subscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') {
      flushListening();
      savePlaybackSession(true);
      return;
    }
    // Voltou ao app: garante que a notificação/tela de bloqueio reflitam a faixa atual.
    const { current, isPlaying } = usePlayer.getState();
    if (current && isPlaying) void activateLockScreenControls(current);
  });

  // Pausado há muito tempo: remove a notificação (ela volta no próximo play). Evita notificação "eterna".
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribePlayer = usePlayer.subscribe((state, previous) => {
    if (state.isPlaying === previous.isPlaying) return;
    if (pauseTimer) clearTimeout(pauseTimer);
    pauseTimer = null;
    if (!state.isPlaying && state.current) {
      pauseTimer = setTimeout(() => {
        pauseTimer = null;
        if (!usePlayer.getState().isPlaying) {
          clearLockScreen();
        }
      }, PAUSED_NOTIFICATION_TTL_MS);
    }
  });
  return () => {
    subscription.remove();
    unsubscribePlayer();
    if (pauseTimer) clearTimeout(pauseTimer);
    flushListening();
    savePlaybackSession(true);
  };
}