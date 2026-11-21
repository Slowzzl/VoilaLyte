import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cliente mínimo do Supabase (Auth + REST + Storage) usando só fetch.
 * Configure no .env (veja SETUP.md):
 *   EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
 */
const URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const backendConfigured = URL.length > 0 && ANON_KEY.length > 0;

const SESSION_KEY = '@spotylite/session/v1';
const EMAIL_DOMAIN = 'users.spotylite.app';

export type Session = {
  accessToken: string;
  refreshToken: string;
  /** epoch em segundos */
  expiresAt: number;
  userId: string;
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let session: Session | null = null;
let refreshing: Promise<Session | null> | null = null;

export const emailFor = (username: string) => `${username.toLowerCase()}@${EMAIL_DOMAIN}`;
export const getSession = () => session;
export const publicCoverUrl = (path: string) => `${URL}/storage/v1/object/public/covers/${path}`;

async function saveSession(next: Session | null) {
  session = next;
  try {
    if (next) await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* a sessão em memória continua valendo */
  }
}

export async function loadSession(): Promise<Session | null> {
  if (!backendConfigured) return null;
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    session = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    session = null;
  }
  return session;
}

function parseSession(data: any): Session {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    userId: data.user?.id,
  };
}

function friendlyError(status: number, body: any): string {
  const raw = String(body?.msg ?? body?.message ?? body?.error_description ?? body?.error ?? '');
  const lower = raw.toLowerCase();
  // "For security purposes, you can only request this after 12 seconds." — mostra o tempo real, não "alguns minutos".
  const wait = lower.match(/after (\d+) seconds?/);
  if (wait) return `Aguarde ${wait[1]} ${wait[1] === '1' ? 'segundo' : 'segundos'} para tentar de novo.`;
  if (lower.includes('invalid login')) return 'Usuário ou senha incorretos.';
  if (lower.includes('already registered') || lower.includes('database error saving new user') || lower.includes('duplicate'))
    return 'Esse nome de usuário já está em uso.';
  if (lower.includes('password') && lower.includes('characters')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (lower.includes('rate limit')) return 'Muitas tentativas. Tente de novo em alguns minutos.';
  if (status === 0) return 'Sem conexão com o servidor.';
  return raw || `Erro ${status}`;
}

async function raw(url: string, init: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError('Sem conexão com o servidor.', 0);
  }
  const text = await response.text();
  let body: any = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) throw new ApiError(friendlyError(response.status, body), response.status);
  return body;
}

// ───────────── Auth ─────────────

export async function signUp(username: string, password: string): Promise<Session> {
  // Uma única requisição: o próprio signup já recusa nome repetido ("already registered" vira a mensagem amigável).
  // A checagem prévia (username_available) custava uma ida e volta a mais em toda tentativa.
  const data = await raw(`${URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailFor(username), password, data: { username } }),
  });
  if (!data?.access_token) {
    // "Confirm email" ligado no Supabase: o login não é liberado sem confirmar o e-mail (que não existe).
    throw new ApiError('Desligue "Confirm email" no Supabase (Authentication > Providers > Email).', 400);
  }
  const next = parseSession(data);
  await saveSession(next);
  return next;
}

export async function signIn(username: string, password: string): Promise<Session> {
  const data = await raw(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: emailFor(username), password }),
  });
  const next = parseSession(data);
  await saveSession(next);
  return next;
}

export async function signOut() {
  await saveSession(null);
}

async function refreshSession(): Promise<Session | null> {
  if (!session) return null;
  refreshing ??= (async () => {
    try {
      const data = await raw(`${URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session!.refreshToken }),
      });
      const next = parseSession(data);
      await saveSession(next);
      return next;
    } catch (error) {
      // Refresh recusado = sessão inválida; erro de rede = tenta de novo depois.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) await saveSession(null);
      return session;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function validToken(): Promise<string> {
  if (!session) throw new ApiError('Entre na sua conta para continuar.', 401);
  if (session.expiresAt - Math.floor(Date.now() / 1000) < 60) await refreshSession();
  if (!session) throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
  return session.accessToken;
}

async function authed(path: string, init: RequestInit = {}, retry = true): Promise<any> {
  const token = await validToken();
  try {
    return await raw(`${URL}${path}`, {
      ...init,
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) },
    });
  } catch (error) {
    if (retry && error instanceof ApiError && error.status === 401) {
      await refreshSession();
      return authed(path, init, false);
    }
    throw error;
  }
}

// ───────────── REST ─────────────

const json = { 'Content-Type': 'application/json' };

export const db = {
  select: <T = any>(table: string, query: string): Promise<T[]> => authed(`/rest/v1/${table}?${query}`),

  insert: (table: string, row: object) =>
    authed(`/rest/v1/${table}`, { method: 'POST', headers: { ...json, Prefer: 'return=minimal' }, body: JSON.stringify(row) }),

  upsert: (table: string, row: object, onConflict: string) =>
    authed(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...json, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    }),

  update: (table: string, query: string, patch: object) =>
    authed(`/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...json, Prefer: 'return=minimal' }, body: JSON.stringify(patch) }),

  remove: (table: string, query: string) => authed(`/rest/v1/${table}?${query}`, { method: 'DELETE' }),
};

export async function uploadCover(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  await authed(`/storage/v1/object/covers/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes as unknown as BodyInit,
  });
  return publicCoverUrl(path);
}

/**
 * Envia uma capa para o bucket público `covers` SEM exigir conta (usa a chave anon).
 * O caminho é derivado do hash do arquivo: se já existir, é a mesma imagem, então "já existe" conta como sucesso
 * (e não precisa de política de UPDATE). Requer o supabase-covers.sql aplicado.
 */
export async function uploadCoverPublic(path: string, bytes: Uint8Array, contentType: string): Promise<string> {
  if (!backendConfigured) throw new ApiError('Servidor (Supabase) não configurado.', 0);
  try {
    await raw(`${URL}/storage/v1/object/covers/${path}`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': contentType, 'x-upsert': 'false' },
      body: bytes as unknown as BodyInit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const duplicate = message.includes('already exists') || message.includes('duplicate') || (error instanceof ApiError && error.status === 409);
    if (!duplicate) {
      if (message.includes('row-level security') || message.includes('unauthorized'))
        throw new ApiError('O Supabase recusou o envio da capa. Rode o supabase-covers.sql no SQL Editor.', 403);
      if (message.includes('maximum allowed size') || message.includes('too large'))
        throw new ApiError('A capa é grande demais para o bucket covers.', 413);
      throw error;
    }
  }
  return publicCoverUrl(path);
}
