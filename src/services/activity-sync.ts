import { AppState } from 'react-native';

import { discordService, useDiscord } from '@/services/discord';
import { cachedCoverFor, loadCoverCache, publicCoverFor } from '@/services/cover-upload';
import { db, getSession } from '@/services/supabase';
import { usePlayer, useProgress } from '@/store/player-store';
import { useSocial } from '@/store/social-store';

/**
 * Publica "o que estou ouvindo" no Discord (se vinculado) e no perfil do app (se logado e com a atividade ligada).
 *
 * Regra do timer: o início exibido = agora - posição. Ao TROCAR de música usamos posição 0 (o store de progresso
 * ainda guarda a posição da música anterior por alguns milissegundos), e depois o detector de "drift" corrige
 * seek, repetição e retomada.
 */
export function initActivitySync(): () => void {
  let lastPlayingId: string | null = null;
  let lastTrackId: string | null = null;
  let sentStart = 0;
  let sentDuration = 0;
  let seq = 0;
  let driftTimer: ReturnType<typeof setTimeout> | null = null;

  const presenceEnabled = () => !!getSession() && useSocial.getState().me?.share_activity === true;
  const discordEnabled = () => {
    const s = useDiscord.getState().status;
    return s === 'ready' || s === 'connecting';
  };

  const stop = () => {
    seq++;
    sentStart = 0;
    if (discordEnabled()) discordService.clearActivity().catch(() => undefined);
    const me = useSocial.getState().me;
    if (me && getSession()) {
      db.upsert('presence', { user_id: me.id, is_playing: false, updated_at: new Date().toISOString() }, 'user_id').catch(
        () => undefined,
      );
    }
  };

  const push = async (startMs: number) => {
    const { current } = usePlayer.getState();
    if (!current) return;
    const { durationMs } = useProgress.getState();
    const duration = durationMs > 0 ? durationMs : current.durationMs;
    const mine = ++seq;
    sentStart = startMs;
    sentDuration = duration;

    const wantsDiscord = discordEnabled();
    const wantsPresence = presenceEnabled();
    if (!wantsDiscord && !wantsPresence) return;

    // 1) Mostra a música NA HORA, com a capa se já houver link (remota ou já enviada antes).
    const sendDiscord = (cover: string) => {
      if (!wantsDiscord) return;
      discordService
        .updateActivity(current.title, current.artist, current.album, cover, startMs, duration)
        .catch((error: unknown) => console.warn('Discord:', error));
    };
    let cover = cachedCoverFor(current);
    sendDiscord(cover);

    // 2) Capa local ainda sem link: envia (uma vez) e atualiza a atividade quando estiver pronta.
    if (!cover && current.coverUrl) {
      cover = await publicCoverFor(current);
      if (mine !== seq) return; // outra música/pausa chegou enquanto a capa subia
      if (cover) sendDiscord(cover);
    }

    const me = useSocial.getState().me;
    if (wantsPresence && me) {
      db.upsert(
        'presence',
        {
          user_id: me.id,
          title: current.title,
          artist: current.artist,
          album: current.album || null,
          cover_url: cover || null,
          started_at: new Date(startMs).toISOString(),
          duration_ms: Math.round(duration) || null,
          is_playing: true,
          updated_at: new Date().toISOString(),
        },
        'user_id',
      ).catch((error: unknown) => console.warn('Presença:', error));
    }
  };

  const onPlayer = () => {
    const { current, isPlaying } = usePlayer.getState();
    const playingId = current && isPlaying ? current.id : null;
    if (playingId === lastPlayingId) return;
    lastPlayingId = playingId;

    if (!playingId || !current) return stop();

    const changed = current.id !== lastTrackId;
    lastTrackId = current.id;
    const { positionMs } = useProgress.getState();
    void push(changed ? Date.now() : Date.now() - Math.max(0, positionMs));
  };

  // Seek, repetição da mesma faixa, duração real descoberta depois, posição corrigida: reenvia.
  const onProgress = () => {
    if (!lastPlayingId || driftTimer) return;
    const check = () => {
      const { positionMs, durationMs } = useProgress.getState();
      const drift = Math.abs(Date.now() - positionMs - sentStart);
      const durationChanged = durationMs > 0 && Math.abs(durationMs - sentDuration) > 1500;
      return drift >= 3000 || durationChanged ? Date.now() - positionMs : null;
    };
    if (check() === null) return;
    driftTimer = setTimeout(() => {
      driftTimer = null;
      if (!lastPlayingId) return;
      const start = check(); // reavalia: a posição pode ter se estabilizado
      if (start !== null) void push(start);
    }, 600);
  };

  // Conta/atividade ligada durante a reprodução, ou Discord que ficou pronto depois.
  const reevaluate = () => {
    if (!lastPlayingId) return;
    const { positionMs } = useProgress.getState();
    void push(Date.now() - Math.max(0, positionMs));
  };
  let lastShare = useSocial.getState().me?.share_activity;
  let lastMe = useSocial.getState().me?.id;
  const unsubSocial = useSocial.subscribe((s) => {
    const share = s.me?.share_activity;
    const id = s.me?.id;
    if (share === lastShare && id === lastMe) return;
    lastShare = share;
    lastMe = id;
    reevaluate();
  });
  let lastDiscord = useDiscord.getState().status;
  const unsubDiscord = useDiscord.subscribe((s) => {
    if (s.status === lastDiscord) return;
    const was = lastDiscord;
    lastDiscord = s.status;
    if (s.status === 'connecting' && was === 'unlinked') reevaluate();
  });

  // Atualiza o ranking do perfil ao sair do app (no máximo a cada 2 minutos).
  let lastTopSync = 0;
  const appSub = AppState.addEventListener('change', (state) => {
    if (state !== 'active' && Date.now() - lastTopSync > 120_000) {
      lastTopSync = Date.now();
      void useSocial.getState().syncTop();
    }
  });

  void loadCoverCache(); // aquece o cache: capas já enviadas aparecem sem esperar
  onPlayer();
  const unsubPlayer = usePlayer.subscribe(onPlayer);
  const unsubProgress = useProgress.subscribe(onProgress);
  return () => {
    unsubPlayer();
    unsubProgress();
    unsubSocial();
    unsubDiscord();
    appSub.remove();
    if (driftTimer) clearTimeout(driftTimer);
    stop();
  };
}
