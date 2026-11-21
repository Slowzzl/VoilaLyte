import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/cover';
import { Button } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { normalizeText, pluralize } from '@/lib/format';
import { useKeyboardOffset } from '@/lib/layout';
import type { Track } from '@/store/library-store';

type RowProps = { track: Track; added: boolean; checked: boolean; onToggle: (trackId: string) => void };

const PickerRow = memo(function PickerRow({ track, added, checked, onToggle }: RowProps) {
  return (
    <Pressable onPress={() => onToggle(track.id)} disabled={added} style={({ pressed }) => [styles.row, added && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
      <Cover uri={track.coverUrl} seed={track.title} size={42} radius={7} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.name}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.artist}>{added ? `${track.artist} · já está na playlist` : track.artist}</Text>
      </View>
      <Ionicons name={added ? 'checkmark-circle' : checked ? 'checkbox' : 'square-outline'} size={24} color={added ? colors.faint : checked ? colors.accent : colors.muted} />
    </Pressable>
  );
});

type Props = {
  visible: boolean;
  onClose: () => void;
  tracks: Track[];
  /** Músicas que já estão na playlist (ficam marcadas e desabilitadas). */
  existingIds: ReadonlySet<string>;
  onConfirm: (trackIds: string[]) => void;
};

/** Escolhe várias músicas da biblioteca de uma vez (lista virtualizada: aguenta bibliotecas grandes). */
export function TrackPickerModal({ visible, onClose, tracks, existingIds, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOffset();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setSelected(new Set());
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return tracks;
    return tracks.filter((track) => normalizeText(`${track.title} ${track.artist} ${track.album}`).includes(q));
  }, [tracks, query]);

  const selectable = useMemo(() => filtered.filter((track) => !existingIds.has(track.id)).map((track) => track.id), [filtered, existingIds]);
  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  const toggle = useCallback((trackId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={keyboard.onLayout} />
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { bottom: keyboard.offset, paddingBottom: keyboard.offset > 0 ? spacing.md : insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Adicionar músicas</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Fechar">
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Buscar músicas ou artistas" placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
        </View>
        {selectable.length > 1 ? (
          <Pressable
            onPress={() => setSelected((previous) => {
              const next = new Set(previous);
              if (allSelected) selectable.forEach((id) => next.delete(id));
              else selectable.forEach((id) => next.add(id));
              return next;
            })}
            hitSlop={8}
            style={styles.selectAll}
          >
            <Text style={styles.selectAllText}>{allSelected ? 'Limpar seleção' : `Selecionar todas (${selectable.length})`}</Text>
          </Pressable>
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(track) => track.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          maxToRenderPerBatch={12}
          extraData={selected}
          renderItem={({ item }) => <PickerRow track={item} added={existingIds.has(item.id)} checked={selected.has(item.id)} onToggle={toggle} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhuma música encontrada.</Text>}
        />
        <Button
          label={selected.size === 0 ? 'Escolha as músicas' : `Adicionar ${pluralize(selected.size, 'música', 'músicas')}`}
          icon="checkmark"
          disabled={selected.size === 0}
          onPress={() => {
            onConfirm([...selected]);
            onClose();
          }}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 13, minHeight: 44, marginBottom: spacing.sm },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 8 },
  selectAll: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 2 },
  selectAllText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  list: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  name: { color: colors.text, fontSize: 14, fontWeight: '700' },
  artist: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
});
