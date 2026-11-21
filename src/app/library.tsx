import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { openAddToPlaylists } from '@/components/add-to-playlists';
import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { SELECTION_BAR_HEIGHT, SelectionBar } from '@/components/selection-bar';
import { TrackRow } from '@/components/track-row';
import { Button, EmptyState, Segmented } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { normalizeText, pluralize } from '@/lib/format';
import { useIncrementalLimit, useSelection } from '@/lib/selection';
import { confirmDeleteTracks } from '@/services/delete-tracks';
import { useLibrary, type Track } from '@/store/library-store';
import { usePlayer } from '@/store/player-store';

type Tab = 'tracks' | 'playlists';

const collator = new Intl.Collator(undefined, { sensitivity: 'variant' });

export default function LibraryScreen() {
  const tracks = useLibrary((s) => s.tracks);
  const playlists = useLibrary((s) => s.playlists);
  const [tab, setTab] = useState<Tab>('playlists');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const selection = useSelection();

  // Ordena uma vez por mudança da biblioteca (Collator reaproveitado é bem mais rápido que localeCompare por par).
  const sortedTracks = useMemo(() => [...tracks].sort((a, b) => collator.compare(a.title, b.title)), [tracks]);
  const filteredTracks = useMemo(() => {
    const q = normalizeText(query);
    if (!q) return sortedTracks;
    return sortedTracks.filter((t) => normalizeText(`${t.title} ${t.artist} ${t.album}`).includes(q));
  }, [sortedTracks, query]);

  // Bibliotecas grandes: monta poucas linhas e libera mais ao rolar.
  const { limit, onScroll, reset } = useIncrementalLimit(filteredTracks.length);
  useEffect(() => reset(), [query, tab, reset]);
  const visibleTracks = useMemo(() => filteredTracks.slice(0, limit), [filteredTracks, limit]);

  const filteredRef = useRef<Track[]>(filteredTracks);
  filteredRef.current = filteredTracks;
  const playTrack = useCallback((track: Track) => usePlayer.getState().play(track, filteredRef.current), []);

  const exitSelection = selection.exit;
  useEffect(() => {
    if (tab !== 'tracks') exitSelection();
  }, [tab, exitSelection]);

  const selectedIds = [...selection.selected];

  const filteredPlaylists = useMemo(() => {
    const q = normalizeText(query);
    return q ? playlists.filter((p) => normalizeText(p.name).includes(q)) : playlists;
  }, [playlists, query]);

  const createPlaylist = () => {
    try {
      const playlist = useLibrary.getState().createPlaylist({ name: newName });
      setNewName('');
      router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } });
    } catch (error) {
      Alert.alert('Playlist', error instanceof Error ? error.message : 'Não foi possível criar a playlist.');
    }
  };

  return (
    <Screen
      title="Biblioteca"
      subtitle={`${pluralize(tracks.length, 'música', 'músicas')} · ${pluralize(playlists.length, 'playlist', 'playlists')}`}
      onScroll={onScroll}
      extraBottom={selection.active ? SELECTION_BAR_HEIGHT : 0}
      right={tab === 'tracks' && tracks.length > 0 ? (
        <Pressable onPress={selection.active ? selection.exit : selection.start} style={styles.selectButton} hitSlop={8}>
          <Ionicons name={selection.active ? 'close' : 'checkmark-done-outline'} size={16} color={colors.text} />
          <Text style={styles.selectText}>{selection.active ? 'Cancelar' : 'Selecionar'}</Text>
        </Pressable>
      ) : undefined}
      footer={selection.active ? (
        <SelectionBar
          count={selection.selected.size}
          total={filteredTracks.length}
          onCancel={selection.exit}
          onToggleAll={() => (selection.selected.size >= filteredTracks.length ? selection.clear() : selection.selectAll(filteredTracks.map((t) => t.id)))}
          actions={[
            { icon: 'add-circle-outline', label: 'Playlists', onPress: () => openAddToPlaylists(selectedIds, { onDone: selection.exit }) },
            { icon: 'trash-outline', label: 'Excluir', danger: true, onPress: () => confirmDeleteTracks(selectedIds, selection.exit) },
          ]}
        />
      ) : undefined}
    >
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={tab === 'tracks' ? 'Buscar músicas ou artistas' : 'Buscar playlists'}
          placeholderTextColor={colors.faint}
          style={styles.searchInput}
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginVertical: spacing.md }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'playlists', label: 'Playlists' },
            { value: 'tracks', label: 'Músicas' },
          ]}
        />
      </View>

      {tab === 'tracks' ? (
        tracks.length === 0 ? (
          <EmptyState icon="musical-notes-outline" title="Nenhuma música ainda" text="Importe arquivos MP3 ou um ZIP com músicas.">
            <Button label="Importar arquivos" icon="add" onPress={() => router.push('/add')} />
          </EmptyState>
        ) : filteredTracks.length === 0 ? (
          <Text style={styles.none}>Nada encontrado para “{query}”.</Text>
        ) : (
          <>
            {selection.active ? null : (
              <Button
                label="Tocar tudo"
                icon="play"
                variant="secondary"
                onPress={() => usePlayer.getState().playList(filteredTracks)}
                style={{ marginBottom: spacing.sm }}
              />
            )}
            {visibleTracks.map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                onPress={playTrack}
                selectionMode={selection.active}
                selected={selection.selected.has(track.id)}
                onToggleSelect={selection.toggle}
              />
            ))}
          </>
        )
      ) : (
        <>
          <View style={styles.newRow}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Nome da nova playlist"
              placeholderTextColor={colors.faint}
              style={styles.newInput}
              maxLength={60}
              onSubmitEditing={createPlaylist}
            />
            <Pressable onPress={createPlaylist} disabled={!newName.trim()} style={[styles.newButton, !newName.trim() && { opacity: 0.4 }]}>
              <Ionicons name="add" size={22} color={colors.onAccent} />
            </Pressable>
          </View>
          {filteredPlaylists.length === 0 ? (
            <Text style={styles.none}>
              {playlists.length === 0 ? 'Crie uma playlist ou importe um ZIP com músicas.' : `Nada encontrado para “${query}”.`}
            </Text>
          ) : (
            filteredPlaylists.map((playlist) => (
              <Pressable key={playlist.id} onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } })} style={styles.playlistRow}>
                <Cover uri={playlist.coverUrl} seed={playlist.name} size={56} radius={10} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={1} style={styles.playlistName}>{playlist.name}</Text>
                  <Text style={styles.playlistSub}>{pluralize(playlist.trackIds.length, 'música', 'músicas')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  selectButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 36 },
  selectText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 46 },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  none: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg, lineHeight: 20 },
  newRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.sm },
  newInput: { flex: 1, color: colors.text, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 18, minHeight: 46 },
  newButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  playlistRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  playlistName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  playlistSub: { color: colors.muted, fontSize: 13 },
});
