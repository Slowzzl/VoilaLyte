
import {
  EventEmitter,
  requireOptionalNativeModule,
} from 'expo-modules-core';
import { Platform } from 'react-native';

import { ensureMusicDirectory, localUri } from '@/services/files';
import {
  isTerminalStatus,
  useDownloads,
  type DownloadStatus,
  type TaskPatch,
} from '@/store/download-store';
import { useLibrary } from '@/store/library-store';

type NativeDownloadResult = {
  id: string;
  fileName: string;
  title: string;
  artist?: string;
  album?: string;
  coverUrl?: string | null;
  durationMs?: number;
  sourceUrl?: string;
};

type NativeDownloadEvent = {
  id: string;
  status: DownloadStatus;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number | null;
  error?: string | null;
  result?: NativeDownloadResult;
};

type NativeDownloaderEvents = {
  onDownloadEvent: (event: NativeDownloadEvent) => void;
};

type NativeDownloader = EventEmitter<NativeDownloaderEvents> & {
  isAvailable?: () => Promise<boolean>;
  enqueue: (
    url: string,
    id: string,
    outputDirectory: string
  ) => Promise<void>;
  cancel?: (id: string) => Promise<void>;
  /** Lista os vídeos de uma playlist do YouTube sem baixar nada (yt-dlp --flat-playlist). */
  resolvePlaylist?: (url: string) => Promise<{
    title: string | null;
    entries: { url: string; title: string }[];
  }>;
};

const nativeDownloader =
  requireOptionalNativeModule<NativeDownloader>(
    'SpotyliteDownloader'
  );

let eventSubscription: { remove: () => void } | null = null;

// ── Fila: no máximo N downloads simultâneos ──────────────────────────────────────────────────────
// Uma playlist de 100 faixas virava 100 workers do yt-dlp ao mesmo tempo. Aqui as faixas esperam
// no JS (já aparecem como "Na fila") e vão para o módulo nativo aos poucos.
// 3 simultâneos aproveitam melhor a banda enquanto uma faixa está em pós-processamento (ffmpeg),
// sem voltar ao "enxame" de processos que travava o aparelho. Se o aparelho for fraco, baixe para 2.
const MAX_CONCURRENT_DOWNLOADS = 3;
/** Eventos de progresso são agrupados e aplicados no máximo a cada ~400 ms (1 atualização de UI/estado). */
const FLUSH_INTERVAL_MS = 400;
/** Sem nenhum evento do módulo nativo por este tempo, a vaga é liberada para a fila não ficar presa. */
const STALL_TIMEOUT_MS = 10 * 60_000;
const WATCHDOG_INTERVAL_MS = 30_000;

type Waiting = { id: string; url: string; directory: string };

const waiting: Waiting[] = [];
const running = new Map<string, number>(); // id -> instante do último evento
let watchdog: ReturnType<typeof setInterval> | null = null;

function startWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    const now = Date.now();
    for (const [id, lastEventAt] of running) {
      if (now - lastEventAt < STALL_TIMEOUT_MS) continue;
      void nativeDownloader?.cancel?.(id)?.catch(() => undefined);
      queuePatch(id, { status: 'failed', error: 'O download parou de responder. Tente novamente.' });
      release(id);
    }
    if (running.size === 0 && watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
  }, WATCHDOG_INTERVAL_MS);
}

// ── Buffer de eventos: em vez de 1 `set()` (e 1 regravação em disco) por evento, 1 por janela ─────
const patchBuffer = new Map<string, TaskPatch>();
const completionBuffer: { taskId: string; result: NativeDownloadResult }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushDueAt = 0;

function scheduleFlush(delay: number = FLUSH_INTERVAL_MS): void {
  const due = Date.now() + delay;
  if (flushTimer && flushDueAt <= due) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushDueAt = due;
  flushTimer = setTimeout(flushEvents, delay);
}

function queuePatch(id: string, patch: TaskPatch, urgent = false): void {
  patchBuffer.set(id, { ...patchBuffer.get(id), ...patch });
  scheduleFlush(urgent || (patch.status && isTerminalStatus(patch.status)) ? 50 : FLUSH_INTERVAL_MS);
}

function flushEvents(): void {
  flushTimer = null;
  const patches: Record<string, TaskPatch> = {};
  for (const [id, patch] of patchBuffer) patches[id] = patch;
  patchBuffer.clear();

  const completions = completionBuffer.splice(0);
  if (completions.length > 0) {
    const tasksById = new Map(useDownloads.getState().tasks.map((task) => [task.id, task]));
    const known = completions.filter((item) => tasksById.has(item.taskId));
    // Uma única atualização da biblioteca para todas as faixas concluídas nesta janela.
    const tracks = useLibrary.getState().registerDownloads(known.map(({ taskId, result }) => {
      const task = tasksById.get(taskId)!;
      return {
        input: {
          title: result.title || task.title,
          artist: result.artist || 'Artista desconhecido',
          album: result.album || '',
          coverUrl: result.coverUrl || null,
          durationMs: Math.max(0, result.durationMs || 0),
          sourceUrl: result.sourceUrl || task.url,
        },
        fileName: result.fileName,
        playlistId: task.playlistId,
      };
    }));
    known.forEach(({ taskId }, index) => {
      patches[taskId] = { trackId: tracks[index].id, status: 'completed', progress: 1, error: null };
    });
  }

  useDownloads.getState().patchTasks(patches);
}

function pump(): void {
  while (nativeDownloader?.enqueue && running.size < MAX_CONCURRENT_DOWNLOADS && waiting.length > 0) {
    const next = waiting.shift()!;
    running.set(next.id, Date.now());
    startWatchdog();
    nativeDownloader.enqueue(next.url, next.id, next.directory).catch((error) => {
      queuePatch(next.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Não foi possível iniciar o download.',
      });
      release(next.id);
    });
  }
}

function release(id: string): void {
  const waitingIndex = waiting.findIndex((item) => item.id === id);
  if (waitingIndex >= 0) waiting.splice(waitingIndex, 1);
  if (running.delete(id)) pump();
}

function assertAllowedSource(url: string): string {
  const clean = url.trim();

  let parsed: URL;

  try {
    parsed = new URL(clean);
  } catch {
    throw new Error('Insira um link válido.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Apenas links HTTP ou HTTPS são aceitos.');
  }

  const host = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, '');

  if (
    host === 'spotify.com' ||
    host.endsWith('.spotify.com')
  ) {
    throw new Error(
      'Links do Spotify servem para importar informações, não para baixar o áudio. Use uma fonte que permita expressamente o download do conteúdo.'
    );
  }

  return parsed.toString();
}

function makeTaskId(): string {
  return `dl_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function handleNativeEvent(event: NativeDownloadEvent): void {
  if (running.has(event.id)) running.set(event.id, Date.now());

  if (event.status === 'completed' && event.result) {
    patchBuffer.delete(event.id);
    completionBuffer.push({ taskId: event.id, result: event.result });
    release(event.id);
    scheduleFlush(FLUSH_INTERVAL_MS);
    return;
  }

  const patch: TaskPatch = {
    status: event.status,
    error: event.error ?? (event.status === 'failed' ? 'O download falhou.' : null),
  };
  if (event.progress !== undefined) patch.progress = Math.max(0, Math.min(1, event.progress));
  if (event.downloadedBytes !== undefined) patch.downloadedBytes = event.downloadedBytes;
  if (event.totalBytes !== undefined) patch.totalBytes = event.totalBytes;
  queuePatch(event.id, patch);

  if (isTerminalStatus(event.status)) release(event.id);
}

/**
 * Depois de fechar/matar o app a fila em memória some, mas as tarefas continuam salvas como "Na fila"/"Baixando"
 * para sempre. Aqui as que ainda não tinham começado voltam para a fila e as que estavam em andamento viram "Falhou"
 * (com botão de tentar de novo), em vez de ficarem travadas para sempre.
 */
let recovered = false;
function recoverInterruptedDownloads(): void {
  if (recovered) return;
  recovered = true;

  const tasks = useDownloads.getState().tasks;
  const patches: Record<string, TaskPatch> = {};
  const resume: Waiting[] = [];
  let directory: string | null = null;

  // A lista é do mais novo para o mais antigo: percorre ao contrário para retomar na ordem original.
  for (let index = tasks.length - 1; index >= 0; index--) {
    const task = tasks[index];
    if (isTerminalStatus(task.status) || running.has(task.id) || waiting.some((item) => item.id === task.id)) continue;
    if (task.status === 'queued') {
      directory ??= ensureMusicDirectory();
      resume.push({ id: task.id, url: task.url, directory });
    } else {
      patches[task.id] = { status: 'failed', error: 'Interrompido ao fechar o app. Toque em "Tentar de novo".' };
    }
  }

  useDownloads.getState().patchTasks(patches);
  if (resume.length > 0) {
    waiting.push(...resume);
    pump();
  }
}

export function subscribeToDownloads(): () => void {
  if (Platform.OS !== 'android' || !nativeDownloader) {
    return () => undefined;
  }

  const emitter = new EventEmitter<NativeDownloaderEvents>(
    nativeDownloader
  );

  eventSubscription?.remove();

  eventSubscription = emitter.addListener(
    'onDownloadEvent',
    handleNativeEvent
  );

  // A fila salva no disco só está disponível depois da hidratação da store.
  if (useDownloads.persist.hasHydrated()) recoverInterruptedDownloads();
  else useDownloads.persist.onFinishHydration(() => recoverInterruptedDownloads());

  return () => {
    eventSubscription?.remove();
    eventSubscription = null;
  };
}

/** Links de playlist do YouTube (youtube.com/playlist?list=…). Link de vídeo com &list= continua baixando só o vídeo. */
export function isYoutubePlaylistUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    const host = parsed.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    return host === 'youtube.com' && parsed.pathname === '/playlist' && parsed.searchParams.has('list');
  } catch {
    return false;
  }
}

/** Baixa todas as faixas de uma playlist do YouTube para uma playlist do Spotylite. */
export async function enqueueYoutubePlaylist(
  rawUrl: string
): Promise<{ playlistId: string; count: number; skipped: number }> {
  if (Platform.OS !== 'android') {
    throw new Error('Os downloads estarão disponíveis apenas no Android.');
  }
  if (!nativeDownloader?.resolvePlaylist) {
    throw new Error(
      'O módulo nativo de downloads está desatualizado. Recompile e instale o app Android para baixar playlists.'
    );
  }

  const url = assertAllowedSource(rawUrl);
  let resolved: Awaited<ReturnType<NonNullable<NativeDownloader['resolvePlaylist']>>>;
  try {
    resolved = await nativeDownloader.resolvePlaylist(url);
  } catch (error) {
    // O Expo embrulha o erro nativo ("Call to function ... has been rejected. → Caused by: ..."): mostra só a causa.
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split('Caused by:').pop()?.trim() || 'Não foi possível ler a playlist.');
  }
  if (!resolved.entries.length) {
    throw new Error('Nenhum vídeo encontrado nessa playlist. Ela pode ser privada ou estar vazia.');
  }

  const library = useLibrary.getState();
  const playlist = library.createPlaylist({
    name: resolved.title || 'Playlist do YouTube',
    sourceUrl: url,
  });
  const directory = ensureMusicDirectory();

  // Reimportar a mesma playlist não baixa de novo o que já está na biblioteca nem o que já está na fila.
  const downloaded = new Map<string, string>();
  for (const track of library.tracks) {
    if (track.fileName && localUri(track.fileName)) downloaded.set(track.sourceUrl, track.id);
  }
  const alreadyActive = new Set<string>();
  for (const task of useDownloads.getState().tasks) {
    if (!isTerminalStatus(task.status)) alreadyActive.add(task.url);
  }

  const seen = new Set<string>();
  const existingTrackIds: string[] = [];
  const fresh: { id: string; url: string; title: string }[] = [];
  for (const entry of resolved.entries) {
    if (seen.has(entry.url)) continue; // o mesmo vídeo repetido na playlist
    seen.add(entry.url);
    const existing = downloaded.get(entry.url);
    if (existing) existingTrackIds.push(existing);
    else if (!alreadyActive.has(entry.url)) fresh.push({ id: makeTaskId(), url: entry.url, title: entry.title || 'Novo download' });
  }

  if (existingTrackIds.length > 0) library.addTracksToPlaylist(playlist.id, existingTrackIds);

  // Uma única atualização para todas as tarefas (antes: uma por faixa, cada uma regravando a fila inteira no disco).
  useDownloads.getState().addTasks(fresh.map((entry) => ({
    id: entry.id,
    url: entry.url,
    title: entry.title,
    playlistId: playlist.id,
  })));
  // Entra na frente da fila, mantendo a ordem da playlist (1ª faixa primeiro).
  waiting.unshift(...fresh.map((entry) => ({ id: entry.id, url: entry.url, directory })));
  pump();

  return { playlistId: playlist.id, count: fresh.length, skipped: seen.size - fresh.length };
}

export async function enqueueAuthorizedDownload(
  rawUrl: string,
  playlistId: string | null = null
): Promise<string> {
  if (Platform.OS !== 'android') {
    throw new Error(
      'Os downloads estarão disponíveis apenas no Android.'
    );
  }

  if (!nativeDownloader?.enqueue) {
    throw new Error(
      'O módulo nativo de downloads não foi encontrado. Recompile e instale o Development Build do Android.'
    );
  }

  const url = assertAllowedSource(rawUrl);
  const id = makeTaskId();

  const title = (() => {
    try {
      return decodeURIComponent(
        new URL(url).pathname
          .split('/')
          .filter(Boolean)
          .pop() || 'Novo download'
      );
    } catch {
      return 'Novo download';
    }
  })();

  useDownloads.getState().addTask({
    id,
    url,
    title,
    playlistId,
  });

  // Passa pela mesma fila dos downloads de playlist (limite de simultâneos + vigia de travamento).
  waiting.push({ id, url, directory: ensureMusicDirectory() });
  pump();
  return id;
}

export async function cancelDownload(
  id: string
): Promise<void> {
  if (!nativeDownloader?.cancel) {
    throw new Error(
      'O cancelamento ainda não está disponível no módulo Android.'
    );
  }

  const wasRunning = running.has(id);
  release(id); // tira da fila de espera (se ainda não começou) e libera a vaga para a próxima faixa
  patchBuffer.delete(id);
  useDownloads.getState().updateTask(id, { status: 'cancelled', error: null });
  if (wasRunning) await nativeDownloader.cancel(id);
}

/** Cancela tudo o que está na fila ou baixando (útil em playlists grandes). */
export async function cancelAllDownloads(): Promise<number> {
  const active = useDownloads.getState().tasks.filter((task) => !isTerminalStatus(task.status));
  if (active.length === 0) return 0;

  const runningIds = active.filter((task) => running.has(task.id)).map((task) => task.id);
  waiting.length = 0;
  for (const id of runningIds) running.delete(id);
  patchBuffer.clear();

  const patches: Record<string, TaskPatch> = {};
  for (const task of active) patches[task.id] = { status: 'cancelled', error: null };
  useDownloads.getState().patchTasks(patches);

  await Promise.all(runningIds.map((id) => nativeDownloader?.cancel?.(id)?.catch(() => undefined)));
  return active.length;
}

/** Tenta de novo as tarefas que falharam (ou foram canceladas). Sem `ids`, todas as que falharam. */
export function retryDownloads(ids?: string[]): number {
  if (Platform.OS !== 'android' || !nativeDownloader?.enqueue) return 0;
  const wanted = ids ? new Set(ids) : null;
  const retry = useDownloads.getState().tasks
    .filter((task) => (wanted ? wanted.has(task.id) : task.status === 'failed') && isTerminalStatus(task.status) && task.status !== 'completed')
    .reverse(); // mais antigas primeiro
  if (retry.length === 0) return 0;

  const directory = ensureMusicDirectory();
  useDownloads.getState().requeueTasks(retry.map((task) => task.id));
  waiting.push(...retry.map((task) => ({ id: task.id, url: task.url, directory })));
  pump();
  return retry.length;
}
