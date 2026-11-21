import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/cover';
import { QueueSheet, openQueue } from '@/components/queue-sheet';
import { SeekBar } from '@/components/seek-bar';
import { SwipeSkip } from '@/components/swipe-skip';
import { colors, radius, spacing } from '@/constants/theme';
import { usePlayer, useProgress } from '@/store/player-store';

function PlaybackSeekControl({ onSeek }: { onSeek: (ms: number) => void }) {
  const positionMs = useProgress((s) => s.positionMs);
  const durationMs = useProgress((s) => s.durationMs);
  return <SeekBar positionMs={positionMs} durationMs={durationMs} onSeek={onSeek} />;
}

export function NowPlaying() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const expanded = usePlayer((s) => s.expanded);
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const error = usePlayer((s) => s.error);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const { toggle, next, prev, seek, toggleShuffle, cycleRepeat, setExpanded } = usePlayer.getState();

  const coverSize = Math.min(width - spacing.lg * 2, 340);

  return (
    <Modal visible={expanded && current !== null} animationType="slide" onRequestClose={() => setExpanded(false)}>
      <GestureHandlerRootView style={styles.root}>
      <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => setExpanded(false)} hitSlop={12} style={styles.headerButton}>
            <Ionicons name="chevron-down" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Tocando agora</Text>
          <Pressable onPress={openQueue} hitSlop={12} style={styles.headerButton} accessibilityLabel="Abrir fila">
            <Ionicons name="list" size={24} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {current ? (
            <>
              <View style={styles.coverWrap}>
                <SwipeSkip maxShift={120}>
                  <Cover uri={current.coverUrl} seed={current.title} size={coverSize} radius={radius.lg} />
                </SwipeSkip>
                <Text style={styles.swipeHint}>Arraste a capa para trocar de música</Text>
              </View>

              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={styles.title}>{current.title}</Text>
                  <Text numberOfLines={1} style={styles.artist}>{current.artist}</Text>
                </View>
                <View style={styles.badge}>
                  <Ionicons name={current.fileName ? 'checkmark-circle' : 'alert-circle-outline'} size={14} color={current.fileName ? colors.accent : colors.muted} />
                  <Text style={styles.badgeText}>{current.fileName ? 'Arquivo local' : 'Sem arquivo local'}</Text>
                </View>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={{ marginTop: spacing.md }}>
                <PlaybackSeekControl onSeek={seek} />
              </View>

              <View style={styles.controls}>
                <Pressable onPress={toggleShuffle} hitSlop={10} style={styles.sideControl}>
                  <Ionicons name="shuffle" size={24} color={shuffle ? colors.accent : colors.muted} />
                </Pressable>
                <Pressable onPress={prev} hitSlop={10}>
                  <Ionicons name="play-skip-back" size={32} color={colors.text} />
                </Pressable>
                <Pressable onPress={toggle} style={styles.playButton}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={34} color={colors.onAccent} style={isPlaying ? undefined : { marginLeft: 3 }} />
                </Pressable>
                <Pressable onPress={next} hitSlop={10}>
                  <Ionicons name="play-skip-forward" size={32} color={colors.text} />
                </Pressable>
                <Pressable onPress={cycleRepeat} hitSlop={10} style={styles.sideControl}>
                  <Ionicons name="repeat" size={24} color={repeat === 'off' ? colors.muted : colors.accent} />
                  {repeat === 'one' ? <Text style={styles.repeatOne}>1</Text> : null}
                </Pressable>
              </View>


            </>
          ) : null}
        </ScrollView>
      </View>
      <QueueSheet inPlayer />
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: 8 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.muted, fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  coverWrap: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg, gap: 10 },
  swipeHint: { color: colors.faint, fontSize: 11 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  artist: { color: colors.muted, fontSize: 16, marginTop: 3 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  badgeText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  error: { color: colors.danger, marginTop: spacing.sm, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  sideControl: { width: 36, alignItems: 'center', justifyContent: 'center' },
  playButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  repeatOne: { position: 'absolute', color: colors.accent, fontSize: 9, fontWeight: '900', top: 9 },
  queue: { marginTop: spacing.xl, gap: 4 },
  queueTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  queueName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  queueArtist: { color: colors.muted, fontSize: 12 },
});
