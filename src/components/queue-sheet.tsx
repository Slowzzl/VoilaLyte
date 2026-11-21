import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Cover } from '@/components/cover';
import { DragReorderRow } from '@/components/drag-reorder-row';
import { colors, radius, spacing } from '@/constants/theme';
import { usePlayer } from '@/store/player-store';

const useQueueSheet = create<{ open: boolean; setOpen: (open: boolean) => void }>()((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

export const openQueue = () => useQueueSheet.getState().setOpen(true);
export const closeQueue = () => useQueueSheet.getState().setOpen(false);

type Row = { key: string; track: ReturnType<typeof usePlayer.getState>['order'][number] };

/** Fila de reprodução em uma folha que só aparece quando o usuário toca no botão da fila. */
/** `inPlayer`: instância dentro do Modal do player aberto (iOS não empilha dois Modals de pais diferentes). */
export function QueueSheet({ inPlayer = false }: { inPlayer?: boolean }) {
  const insets = useSafeAreaInsets();
  const open = useQueueSheet((s) => s.open);
  const order = usePlayer((s) => s.order);
  const index = usePlayer((s) => s.index);
  const current = usePlayer((s) => s.current);
  const expanded = usePlayer((s) => s.expanded);
  const { playQueueIndex, moveInQueue } = usePlayer.getState();

  const played = order.slice(0, index);
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);

  useEffect(() => {
    const next = order.slice(index + 1).map((track, offset) => ({ key: `${track.id}-${index + 1 + offset}`, track }));
    rowsRef.current = next;
    setRows(next);
  }, [order, index]);

  const visible = rows.length === order.length - index - 1
    ? rows
    : order.slice(index + 1).map((track, offset) => ({ key: `${track.id}-${index + 1 + offset}`, track }));

  return (
    <Modal visible={open && current !== null && expanded === inPlayer} transparent animationType="slide" onRequestClose={closeQueue}>
      <Pressable style={styles.backdrop} onPress={closeQueue} />
      <GestureHandlerRootView style={styles.sheetRoot} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Fila</Text>
            <Pressable onPress={closeQueue} hitSlop={12} accessibilityLabel="Fechar fila">
              <Ionicons name="close" size={24} color={colors.muted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {current ? (
              <>
                <Text style={styles.section}>Tocando agora</Text>
                <View style={styles.row}>
                  <Cover uri={current.coverUrl} seed={current.title} size={44} radius={8} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={[styles.name, { color: colors.accent }]}>{current.title}</Text>
                    <Text numberOfLines={1} style={styles.artist}>{current.artist}</Text>
                  </View>
                  <Ionicons name="volume-high" size={18} color={colors.accent} />
                </View>
              </>
            ) : null}

            <Text style={styles.section}>A seguir</Text>
            {visible.length === 0 ? <Text style={styles.empty}>Nada na fila. Use “Adicionar à fila” no menu de uma música.</Text> : null}
            {visible.map(({ key, track }, offset) => (
              <DragReorderRow
                key={key}
                index={offset}
                count={visible.length}
                onPreviewMove={(from, to) => {
                  const next = [...rowsRef.current];
                  const [moving] = next.splice(from, 1);
                  next.splice(to, 0, moving);
                  rowsRef.current = next;
                  setRows(next);
                }}
                onDrop={(from, to) => {
                  if (from === to) return;
                  const latest = usePlayer.getState();
                  moveInQueue(latest.index + 1 + from, latest.index + 1 + to);
                }}
              >
                <Pressable onPress={() => playQueueIndex(index + offset + 1)} style={styles.row}>
                  <Cover uri={track.coverUrl} seed={track.title} size={44} radius={8} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.name}>{track.title}</Text>
                    <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
                  </View>
                </Pressable>
              </DragReorderRow>
            ))}

            {played.length > 0 ? (
              <>
                <Text style={styles.section}>Já tocadas</Text>
                {played.map((track, i) => (
                  <Pressable key={`${track.id}-${i}`} onPress={() => playQueueIndex(i)} style={styles.row}>
                    <Cover uri={track.coverUrl} seed={track.title} size={44} radius={8} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={styles.name}>{track.title}</Text>
                      <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
                    </View>
                    <Ionicons name="play-circle-outline" size={22} color={colors.muted} />
                  </Pressable>
                ))}
              </>
            ) : null}
          </ScrollView>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '78%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  section: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  artist: { color: colors.muted, fontSize: 12.5 },
  empty: { color: colors.faint, fontSize: 13, paddingVertical: 8 },
});
