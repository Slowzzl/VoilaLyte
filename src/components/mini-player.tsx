import { Ionicons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { openQueue } from '@/components/queue-sheet';
import { SwipeSkip } from '@/components/swipe-skip';
import { MINI_PLAYER_HEIGHT, colors, radius } from '@/constants/theme';
import { hidesTabBar, useChrome, useKeyboardVisible } from '@/lib/layout';
import { usePlayer, useProgress } from '@/store/player-store';

export function MiniPlayer() {
  const pathname = usePathname();
  const keyboardVisible = useKeyboardVisible();
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const error = usePlayer((s) => s.error);
  const toggle = usePlayer((s) => s.toggle);
  const setExpanded = usePlayer((s) => s.setExpanded);
  const ratio = useProgress((s) => (s.durationMs > 0 ? Math.min(1, s.positionMs / s.durationMs) : 0));
  // Sem barra de abas (ex.: dentro de uma playlist) o mini player desce até o rodapé.
  const { miniBottom } = useChrome({ tabBar: !hidesTabBar(pathname), mini: true });

  if (!current || keyboardVisible) return null;

  return (
    <View style={[styles.wrap, { bottom: miniBottom }]} pointerEvents="box-none">
      <SwipeSkip style={styles.swipe}>
        <Pressable onPress={() => setExpanded(true)} style={styles.card}>
          <Cover uri={current.coverUrl} seed={current.title} size={44} radius={8} />
          <View style={styles.info}>
            <Text numberOfLines={1} style={styles.title}>{current.title}</Text>
            <Text numberOfLines={1} style={[styles.artist, error ? { color: colors.danger } : null]}>
              {error ?? current.artist}
            </Text>
          </View>
          <Pressable onPress={openQueue} hitSlop={8} style={styles.skip} accessibilityLabel="Abrir fila">
            <Ionicons name="list" size={22} color={colors.text} />
          </Pressable>
          <Pressable onPress={toggle} hitSlop={8} style={styles.play} accessibilityLabel={isPlaying ? 'Pausar' : 'Tocar'}>
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={colors.onAccent} style={isPlaying ? undefined : { marginLeft: 2 }} />
          </Pressable>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${ratio * 100}%` }]} />
          </View>
        </Pressable>
      </SwipeSkip>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, height: MINI_PLAYER_HEIGHT, justifyContent: 'center' },
  swipe: { height: MINI_PLAYER_HEIGHT - 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: MINI_PLAYER_HEIGHT - 8,
    paddingHorizontal: 10,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  info: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  artist: { color: colors.muted, fontSize: 12 },
  play: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  skip: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.08)' },
  progressFill: { height: '100%', backgroundColor: colors.accent },
});
