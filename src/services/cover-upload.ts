import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { NativeModules, Platform } from 'react-native';
import { create } from 'zustand';

import { backendConfigured, uploadCoverPublic } from '@/services/supabase';
import type { Track } from '@/store/library-store';

/**
 * Capa da faixa -> URL https pública, que é a única coisa que o Discord aceita na atividade.
 *
 *  - Capa remota (ex.: miniatura do YouTube): normalizada para um link que o Discord realmente abre.
 *  - Capa local (arte do MP3/ZIP): reduzida no Android (512 px, JPEG), enviada ao bucket público `covers`
 *    UMA vez (nome = hash do arquivo) e guardada em cache. Não depende de conta logada.
 *
 * O resultado do último envio fica em `useCoverStatus` para o Perfil mostrar o motivo quando a capa não aparece.
 */

const CACHE_KEY = '@spotylite/cover-urls/v2';
const RETRY_AFTER_MS = 60_000;

let cache: Record<string, string> | null = null;
const inflight = new Map<string, Promise<string>>();
const failedAt = new Map<string, number>();

export type CoverState = 'idle' | 'uploading' | 'ready' | 'error';
export const useCoverStatus = create<{ state: CoverState; message: string | null }>()(() => ({
  state: 'idle',
  message: null,
}));
const setStatus = (state: CoverState, message: string | null = null) => useCoverStatus.setState({ state, message });

export async function loadCoverCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse((await AsyncStorage.getItem(CACHE_KEY)) ?? '{}');
  } catch {
    cache = {};
  }
  return cache!;
}

const isRemote = (uri?: string | null): boolean => !!uri && /^https?:\/\//i.test(uri);

/** Deixa o link da capa no formato que o Discord abre sem problema. */
export function normalizeRemoteCover(url: string): string {
  let out = url.trim().replace(/^http:\/\//i, 'https://');
  if (/(^|\.)ytimg\.com\//i.test(out)) {
    out = out
      .split('?')[0]
      .replace(/\/vi_webp\/([^/]+)\/([^/]+)\.webp$/i, '/vi/$1/$2.jpg') // webp -> jpg
      .replace(/\/(maxresdefault|sddefault)(\.[a-z]+)$/i, '/hqdefault$2'); // maxres não existe em todo vídeo (404)
  }
  return out;
}

/** Resposta imediata, sem rede: capa remota ou capa local que já foi enviada antes. */
export function cachedCoverFor(track: Pick<Track, 'coverUrl'>): string {
  const uri = track.coverUrl;
  if (!uri) return '';
  if (isRemote(uri)) return normalizeRemoteCover(uri);
  return cache?.[uri] ?? '';
}

function mimeFor(ext: string) {
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}

async function uploadLocal(uri: string): Promise<string> {
  const source = new File(uri);
  if (!source.exists) throw new Error('O arquivo da capa não foi encontrado.');
  const digest = await source.digest('SHA-256');

  let upload = source;
  let ext = (uri.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  let suffix = '';

  // Arte de MP3 costuma ter vários MB; o Discord falha em imagens enormes. O Android reduz para 512 px.
  const native = NativeModules.DiscordModule;
  if (Platform.OS === 'android' && native?.prepareCover) {
    try {
      upload = new File(await native.prepareCover(uri));
      ext = 'jpg';
      suffix = '-512';
    } catch (error) {
      console.warn('Não foi possível reduzir a capa; enviando o original.', error);
    }
  }

  const url = await uploadCoverPublic(`c/${digest}${suffix}.${ext}`, await upload.bytes(), mimeFor(ext));

  // Confirma que o link abre sem login: se o bucket não for público, o Discord também não vai enxergar.
  const check = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (check && !check.ok) {
    throw new Error(`A capa foi enviada, mas o link não é público (HTTP ${check.status}). Rode o supabase-covers.sql.`);
  }
  return url;
}

/** URL pública da capa da faixa, ou '' se não houver/não for possível. */
export async function publicCoverFor(track: Pick<Track, 'id' | 'coverUrl'>): Promise<string> {
  const uri = track.coverUrl;
  if (!uri) {
    setStatus('idle');
    return '';
  }
  if (isRemote(uri)) {
    setStatus('ready');
    return normalizeRemoteCover(uri);
  }
  if (!backendConfigured) {
    setStatus('error', 'O servidor (Supabase) não está configurado: sem ele a capa local não vira link público.');
    return '';
  }

  const map = await loadCoverCache();
  if (map[uri]) {
    setStatus('ready');
    return map[uri];
  }

  const lastFailure = failedAt.get(uri);
  if (lastFailure && Date.now() - lastFailure < RETRY_AFTER_MS) return '';

  let pending = inflight.get(uri);
  if (!pending) {
    setStatus('uploading');
    pending = (async () => {
      try {
        const url = await uploadLocal(uri);
        map[uri] = url;
        AsyncStorage.setItem(CACHE_KEY, JSON.stringify(map)).catch(() => undefined);
        setStatus('ready');
        return url;
      } catch (error) {
        failedAt.set(uri, Date.now());
        const message = error instanceof Error ? error.message : 'Falha desconhecida.';
        console.warn('Capa para o Discord:', message);
        setStatus('error', message);
        return '';
      } finally {
        inflight.delete(uri);
      }
    })();
    inflight.set(uri, pending);
  }
  return pending;
}
