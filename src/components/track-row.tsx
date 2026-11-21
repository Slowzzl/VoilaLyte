import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { openTrackMenu } from '@/components/track-menu';
import { colors } from '@/constants/theme';
import { formatClock } from '@/lib/format';
import type { Track } from '@/store/library-store';
import { usePlayer } from '@/store/player-store';

type Props = {
  track: Track;
  onPress: (track: Track) => void;
  /** Se informado, o menu mostra "Remover desta playlist". */
  playlistId?: string;
  rank?: number;
  /** Modo de seleção: o toque marca/desmarca em vez de tocar a música. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (trackId: string) => void;
};

function TrackRowComponent({ track, onPress, playlistId, rank, selectionMode = false, selected = false, onToggleSelect }: Props) {
  const active = usePlayer((s) => s.current?.id === track.id);
  const playing = usePlayer((s) => s.current?.id === track.id && s.isPlaying);
  return (
    <Pressable
      onPress={() => (selectionMode ? onToggleSelect?.(track.id) : onPress(track))}
      onLongPress={selectionMode ? undefined : () => openTrackMenu(track, playlistId)}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && { opacity: 0.7 }]}
    >
      {selectionMode ? (
        <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={22} color={selected ? colors.accent : colors.muted} />
      ) : null}
      {rank !== undefined ? <Text style={styles.rank}>{rank}</Text> : null}
      <View>
        <Cover uri={track.coverUrl} seed={track.title} size={48} radius={8} />
        {active ? (
          <View style={styles.activeOverlay}>
            <Ionicons name={playing ? 'volume-high' : 'pause'} size={18} color={colors.accent} />
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text numberOfLines={1} style={[styles.title, active && { color: colors.accent }]}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.sub}>
          {track.artist}
          {track.durationMs > 0 ? ` · ${formatClock(track.durationMs)}` : ''}
        </Text>
      </View>
      {track.fileName ? <Ionicons name="checkmark-circle-outline" size={16} color={colors.accent} /> : null}
      {selectionMode ? null : (
        <Pressable onPress={() => openTrackMenu(track, playlistId)} hitSlop={10} style={styles.more}>
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.muted} />
        </Pressable>
      )}
    </Pressable>
  );
}

/** Memoizada: com centenas de linhas, só re-renderiza a que realmente mudou (ex.: faixa recém-baixada). */
export const TrackRow = memo(TrackRowComponent);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, borderRadius: 10 },
  rowSelected: { backgroundColor: 'rgba(184,240,60,0.08)' },
  rank: { width: 20, textAlign: 'center', color: colors.muted, fontSize: 14, fontWeight: '800' },
  activeOverlay: { ...StyleSheet.absoluteFill, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12.5 },
  more: { padding: 4 },
});
