import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { create } from 'zustand';

const { DiscordModule } = NativeModules;

export const discordAvailable = Platform.OS === 'android' && !!DiscordModule;

export type DiscordLinkStatus = 'unavailable' | 'unlinked' | 'connecting' | 'ready' | 'error';

type DiscordState = {
  status: DiscordLinkStatus;
  error: string | null;
  set: (status: DiscordLinkStatus, error?: string | null) => void;
};

export const useDiscord = create<DiscordState>()((set) => ({
  status: discordAvailable ? 'unlinked' : 'unavailable',
  error: null,
  set: (status, error = null) => set({ status, error }),
}));

function applyNativeStatus(raw: string) {
  if (raw.startsWith('error:')) useDiscord.getState().set('error', raw.slice(6));
  else if (raw === 'ready' || raw === 'connecting' || raw === 'unlinked') useDiscord.getState().set(raw);
}

/** Escuta o estado da conexão nativa. Chame uma vez no layout raiz. */
export function initDiscordStatus(): () => void {
  if (!discordAvailable) return () => undefined;
  const emitter = new NativeEventEmitter(DiscordModule);
  const subscription = emitter.addListener('DiscordStatus', (status: string) => applyNativeStatus(status));
  DiscordModule.getStatus()
    .then((status: string) => applyNativeStatus(status))
    .catch(() => undefined);
  return () => subscription.remove();
}

export const discordService = {
  /** Abre a autorização do Discord. Só é chamado pelo botão "Vincular" do perfil. */
  async connect() {
    if (!discordAvailable) return false;
    useDiscord.getState().set('connecting');
    return DiscordModule.connect();
  },

  async disconnect() {
    if (!discordAvailable) return false;
    return DiscordModule.disconnect();
  },

  async updateActivity(
    title: string,
    artist: string,
    album: string,
    coverUrl: string,
    startMs: number,
    durationMs: number,
  ) {
    if (!discordAvailable) return false;
    const endMs = durationMs > 0 ? startMs + durationMs : 0;
    return DiscordModule.updateActivity(title, artist || 'Artista desconhecido', album || '', coverUrl, startMs, endMs);
  },

  async clearActivity() {
    if (!discordAvailable) return false;
    return DiscordModule.clearActivity();
  },
};

/** Hook de conveniência para telas. */
export function useDiscordStatus() {
  const status = useDiscord((s) => s.status);
  const error = useDiscord((s) => s.error);
  return { status, error };
}
