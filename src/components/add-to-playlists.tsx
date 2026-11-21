import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { Cover } from '@/components/cover';
import { Button } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { normalizeText, pluralize } from '@/lib/format';
import { useKeyboardOffset } from '@/lib/layout';
import { notify } from '@/lib/notify';
import { useLibrary, type Playlist } from '@/store/library-store';

type SheetState = {
  trackIds: string[] | null;
  onDone?: () => void;
  open: (trackIds: string[], onDone?: () => void) => void;
  close: () => void;
};

const useSheet = create<SheetState>()((set) => ({
  trackIds: null,
  onDone: undefined,
  open: (trackIds, onDone) => set({ trackIds, onDone }),
  close: () => set({ trackIds: null, onDone: undefined }),
}));

/**
 * Abre a folha "Adicionar a playlists" para uma ou várias músicas.
 * `delayMs` existe para quando é chamada de dentro de outro Modal (ex.: menu da faixa): no iOS/Android o novo Modal
 * só abre com segurança depois que o anterior terminou de fechar.
 */
export function openAddToPlaylists(trackIds: string[], options?: { onDone?: () => void; delayMs?: number }): void {
  if (trackIds.length === 0) return;
  const open = () => useSheet.getState().open(trackIds, options?.onDone);
  if (options?.delayMs) setTimeout(open, options.delayMs);
  else open();
}

type RowProps = {
  playlist: Playlist;
  /** Quantas das músicas escolhidas já estão nesta playlist. */
  have: number;
  total: number;
  checked: boolean;
  onToggle: (playlistId: string) => void;
};

const PlaylistRow = memo(function PlaylistRow({ playlist, have, total, checked, onToggle }: RowProps) {
  const full = have >= total;
  return (
    <Pressable onPress={() => onToggle(playlist.id)} disabled={full} style={({ pressed }) => [styles.row, full && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}>
      <Cover uri={playlist.coverUrl} seed={playlist.name} size={44} radius={8} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={styles.rowName}>{playlist.name}</Text>
        <Text numberOfLines={1} style={styles.rowSub}>
          {full
            ? (total === 1 ? 'Já está nesta playlist' : 'Todas já estão nesta playlist')
            : have > 0
              ? `${have} de ${total} já estão aqui · ${pluralize(playlist.trackIds.length, 'música', 'músicas')}`
              : pluralize(playlist.trackIds.length, 'música', 'músicas')}
        </Text>
      </View>
      <Ionicons
        name={full ? 'checkmark-circle' : checked ? 'checkbox' : 'square-outline'}
        size={24}
        color={full ? colors.faint : checked ? colors.accent : colors.muted}
      />
    </Pressable>
  );
});

/** Montada uma vez no layout raiz. Escolha várias playlists e adicione as músicas a todas de uma vez. */
export function AddToPlaylistsSheet() {
  const trackIds = useSheet((s) => s.trackIds);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOffset();
  const playlists = useLibrary((s) => s.playlists);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const visible = trackIds !== null;

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setNewName('');
      setSelected(new Set());
    }
  }, [visible]);

  const total = trackIds?.length ?? 0;
  // Quantas das músicas escolhidas já existem em cada playlist (Set por playlist: evita includes() em loop).
  const haveByPlaylist = useMemo(() => {
    const wanted = new Set(trackIds ?? []);
    const result = new Map<string, number>();
    for (const playlist of playlists) {
      let count = 0;
      for (const id of playlist.trackIds) if (wanted.has(id)) count++;
      result.set(playlist.id, count);
    }
    return result;
  }, [playlists, trackIds]);

  const filtered = useMemo(() => {
    const q = normalizeText(query);
    return q ? playlists.filter((playlist) => normalizeText(playlist.name).includes(q)) : playlists;
  }, [playlists, query]);

  const selectable = useMemo(
    () => filtered.filter((playlist) => (haveByPlaylist.get(playlist.id) ?? 0) < total).map((playlist) => playlist.id),
    [filtered, haveByPlaylist, total],
  );

  const toggle = useCallback((playlistId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(playlistId)) next.delete(playlistId);
      else next.add(playlistId);
      return next;
    });
  }, []);

  const close = () => useSheet.getState().close();

  const createPlaylist = () => {
    try {
      const playlist = useLibrary.getState().createPlaylist({ name: newName });
      setNewName('');
      setSelected((previous) => new Set(previous).add(playlist.id)); // já vem marcada
    } catch {
      // nome vazio: o botão fica desabilitado, nada a fazer
    }
  };

  const confirm = () => {
    if (!trackIds || selected.size === 0) return;
    const playlistCount = selected.size;
    const added = useLibrary.getState().addTracksToPlaylists([...selected], trackIds);
    const onDone = useSheet.getState().onDone;
    close();
    notify(added === 0
      ? 'Nada novo para adicionar'
      : `${pluralize(total, 'música adicionada', 'músicas adicionadas')} a ${pluralize(playlistCount, 'playlist', 'playlists')}`);
    onDone?.();
  };

  const allSelected = selectable.length > 0 && selectable.every((id) => selected.has(id));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={keyboard.onLayout} />
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { bottom: keyboard.offset, paddingBottom: keyboard.offset > 0 ? spacing.md : insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Adicionar a playlists</Text>
            <Text style={styles.subtitle}>{pluralize(total, 'música selecionada', 'músicas selecionadas')}</Text>
          </View>
          <Pressable onPress={close} hitSlop={12} accessibilityLabel="Fechar">
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <View style={styles.newRow}>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Nova playlist"
            placeholderTextColor={colors.faint}
            style={styles.input}
            maxLength={60}
            returnKeyType="done"
            onSubmitEditing={createPlaylist}
          />
          <Pressable onPress={createPlaylist} disabled={!newName.trim()} style={[styles.createButton, !newName.trim() && { opacity: 0.4 }]} accessibilityLabel="Criar playlist">
            <Ionicons name="add" size={22} color={colors.onAccent} />
          </Pressable>
        </View>

        {playlists.length > 6 ? (
          <View style={styles.search}>
            <Ionicons name="search" size={17} color={colors.muted} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Buscar playlists" placeholderTextColor={colors.faint} style={styles.searchInput} autoCorrect={false} />
          </View>
        ) : null}

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
            <Text style={styles.selectAllText}>{allSelected ? 'Limpar seleção' : 'Selecionar todas'}</Text>
          </Pressable>
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(playlist) => playlist.id}
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          renderItem={({ item }) => (
            <PlaylistRow playlist={item} have={haveByPlaylist.get(item.id) ?? 0} total={total} checked={selected.has(item.id)} onToggle={toggle} />
          )}
          ListEmptyComponent={<Text style={styles.empty}>{playlists.length === 0 ? 'Você ainda não tem playlists. Crie uma acima.' : 'Nenhuma playlist encontrada.'}</Text>}
        />

        <Button
          label={selected.size === 0 ? 'Escolha as playlists' : `Adicionar a ${pluralize(selected.size, 'playlist', 'playlists')}`}
          icon="checkmark"
          onPress={confirm}
          disabled={selected.size === 0}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '86%', backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  newRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  input: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 44 },
  createButton: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 13, minHeight: 42, marginBottom: spacing.sm },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 8 },
  selectAll: { alignSelf: 'flex-end', paddingVertical: 4, marginBottom: 2 },
  selectAllText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  list: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  rowName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
});
