import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { openAddToPlaylists } from '@/components/add-to-playlists';
import { Cover } from '@/components/cover';
import { BulkRenameModal, GroupCreatorModal } from '@/components/playlist-tools';
import { Screen } from '@/components/screen';
import { SELECTION_BAR_HEIGHT, SelectionBar } from '@/components/selection-bar';
import { TrackPickerModal } from '@/components/track-picker';
import { TrackRow } from '@/components/track-row';
import { Button, EmptyState } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { formatListening, pluralize } from '@/lib/format';
import { useKeyboardOffset } from '@/lib/layout';
import { useIncrementalLimit, useSelection } from '@/lib/selection';
import { confirmDeleteTracks, confirmRemoveFromPlaylist } from '@/services/delete-tracks';
import { useLibrary, type Track } from '@/store/library-store';
import { usePlayer } from '@/store/player-store';
import { DragReorderRow } from '../../components/drag-reorder-row';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [addingTracks, setAddingTracks] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [bulkRenaming, setBulkRenaming] = useState(false);
  const keyboard = useKeyboardOffset();
  const [displayTrackIds, setDisplayTrackIds] = useState<string[] | null>(null);
  const displayTrackIdsRef = useRef<string[]>([]);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === id));
  const allTracks = useLibrary((s) => s.tracks);

  const selection = useSelection();
  const byId = useMemo(() => new Map(allTracks.map((track) => [track.id, track])), [allTracks]);

  const tracks = useMemo(() => {
    if (!playlist) return [];
    return playlist.trackIds.map((tid) => byId.get(tid)).filter((t): t is Track => !!t);
  }, [playlist, byId]);

  useEffect(() => {
    const nextIds = playlist?.trackIds ?? [];
    displayTrackIdsRef.current = nextIds;
    setDisplayTrackIds(nextIds);
  }, [playlist?.id, playlist?.trackIds]);

  const orderedTrackIds = displayTrackIds ?? playlist?.trackIds ?? [];
  const orderedTracks = useMemo(
    () => orderedTrackIds.map((trackId) => byId.get(trackId)).filter((track): track is Track => !!track),
    [byId, orderedTrackIds],
  );

  // Playlists grandes: monta poucas linhas (cada uma tem gesto de arrastar + animação) e libera mais ao rolar.
  const { limit, onScroll } = useIncrementalLimit(orderedTracks.length);
  const visibleTracks = useMemo(() => orderedTracks.slice(0, limit), [orderedTracks, limit]);

  const existingIds = useMemo(() => new Set(playlist?.trackIds ?? []), [playlist?.trackIds]);

  const groupsRef = useRef(playlist?.groups ?? []);
  groupsRef.current = playlist?.groups ?? [];
  const orderedRef = useRef<Track[]>(orderedTracks);
  orderedRef.current = orderedTracks;
  const playTrack = useCallback(
    (track: Track) => usePlayer.getState().play(track, orderedRef.current, groupsRef.current),
    [],
  );
  const onPreviewMove = useCallback((fromIndex: number, toIndex: number) => {
    const nextIds = [...displayTrackIdsRef.current];
    const [movingId] = nextIds.splice(fromIndex, 1);
    nextIds.splice(toIndex, 0, movingId);
    displayTrackIdsRef.current = nextIds;
    setDisplayTrackIds(nextIds);
  }, []);
  const playlistId = playlist?.id;
  const onDrop = useCallback(() => {
    // Uma única gravação no Zustand/AsyncStorage, somente ao soltar.
    if (playlistId) useLibrary.getState().reorderPlaylistTracks(playlistId, displayTrackIdsRef.current);
  }, [playlistId]);

  if (!playlist) {
    return (
      <Screen hideTabBar>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <EmptyState icon="alert-circle-outline" title="Playlist não encontrada" text="Ela pode ter sido apagada." />
      </Screen>
    );
  }

  const savePlaylistName = () => {
    try {
      useLibrary.getState().renamePlaylist(playlist.id, nameDraft);
      setEditingName(false);
    } catch (error) {
      Alert.alert('Renomear playlist', error instanceof Error ? error.message : 'Não foi possível renomear a playlist.');
    }
  };

  const changePlaylistCover = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/jpeg', 'image/png', 'image/webp'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const extension = asset.name.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase();
      const mimeType = asset.mimeType ?? (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');
      if (!extension && !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        throw new Error('Selecione uma imagem JPG, PNG ou WEBP.');
      }

      let coverUri: string;
      if (Platform.OS === 'web') {
        if (!asset.base64) throw new Error('Não foi possível ler a imagem selecionada.');
        coverUri = `data:${mimeType};base64,${asset.base64}`;
      } else {
        const safeExtension = extension === 'jpeg' ? 'jpg' : extension ?? mimeType.split('/')[1];
        const destination = new File(Paths.document, `playlist-cover-${Crypto.randomUUID()}.${safeExtension}`);
        await new File(asset.uri).copy(destination);
        coverUri = destination.uri;
      }
      useLibrary.getState().setPlaylistCover(playlist.id, coverUri);
    } catch (error) {
      Alert.alert('Capa da playlist', error instanceof Error ? error.message : 'Não foi possível trocar a capa.');
    }
  };

  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const confirmDelete = () =>
    Alert.alert('Apagar playlist', `"${playlist.name}" será apagada. As músicas continuam na biblioteca.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: () => {
          useLibrary.getState().deletePlaylist(playlist.id);
          router.back();
        },
      },
    ]);

  const selectedIds = [...selection.selected];

  return (
    <Screen
      hideTabBar
      onScroll={onScroll}
      extraBottom={selection.active ? SELECTION_BAR_HEIGHT : 0}
      footer={selection.active ? (
        <SelectionBar
          hideTabBar
          count={selection.selected.size}
          total={orderedTracks.length}
          onCancel={selection.exit}
          onToggleAll={() => (selection.selected.size >= orderedTracks.length ? selection.clear() : selection.selectAll(orderedTracks.map((t) => t.id)))}
          actions={[
            { icon: 'add-circle-outline', label: 'Playlists', onPress: () => openAddToPlaylists(selectedIds, { onDone: selection.exit }) },
            { icon: 'remove-circle-outline', label: 'Remover', onPress: () => confirmRemoveFromPlaylist(playlist.id, playlist.name, selectedIds, selection.exit) },
            { icon: 'trash-outline', label: 'Excluir', danger: true, onPress: () => confirmDeleteTracks(selectedIds, selection.exit) },
          ]}
        />
      ) : undefined}
    >
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.topActions}>
          <Pressable
            onPress={() => { setNameDraft(playlist.name); setEditingName(true); }}
            style={styles.back}
            hitSlop={10}
            accessibilityLabel="Renomear playlist"
          >
            <Ionicons name="create-outline" size={21} color={colors.muted} />
          </Pressable>
          <Pressable onPress={confirmDelete} style={styles.back} hitSlop={10} accessibilityLabel="Apagar playlist">
            <Ionicons name="trash-outline" size={21} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      <View style={styles.header}>
        <Pressable onPress={changePlaylistCover} style={styles.coverButton} accessibilityLabel="Trocar foto da playlist">
          <Cover uri={playlist.coverUrl} seed={playlist.name} size={170} radius={16} />
          <View style={styles.coverEdit}>
            <Ionicons name="camera-outline" size={18} color={colors.onAccent} />
          </View>
        </Pressable>
        {editingName ? (
          <View style={styles.nameEditor}>
            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              onSubmitEditing={savePlaylistName}
              autoFocus
              maxLength={60}
              returnKeyType="done"
              placeholder="Nome da playlist"
              placeholderTextColor={colors.faint}
              style={styles.nameInput}
            />
            <Pressable onPress={savePlaylistName} style={styles.nameAction} accessibilityLabel="Salvar nome">
              <Ionicons name="checkmark" size={20} color={colors.onAccent} />
            </Pressable>
            <Pressable onPress={() => setEditingName(false)} style={[styles.nameAction, styles.cancelName]} accessibilityLabel="Cancelar">
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
        ) : (
          <Text style={styles.name}>{playlist.name}</Text>
        )}
        <Text style={styles.meta}>
          {pluralize(tracks.length, 'música', 'músicas')}
          {totalMs > 0 ? ` · ${formatListening(totalMs)}` : ''}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Reproduzir"
          icon="play"
          onPress={() => usePlayer.getState().playList(tracks, { shuffle: false, groups: playlist.groups ?? [] })}
          disabled={tracks.length === 0}
          style={{ flex: 1 }}
        />
        <Button
          label="Aleatório"
          icon="shuffle"
          variant="secondary"
          onPress={() => usePlayer.getState().playList(tracks, { shuffle: true, groups: playlist.groups ?? [] })}
          disabled={tracks.length === 0}
          style={{ flex: 1 }}
        />
      </View>

      <Button
        label="Adicionar músicas"
        icon="add"
        variant="secondary"
        onPress={() => setAddingTracks(true)}
        style={{ marginTop: spacing.sm }}
      />
      <View style={[styles.actions, { marginTop: spacing.sm }]}>
        <Button
          label={selection.active ? 'Cancelar seleção' : 'Selecionar'}
          icon={selection.active ? 'close' : 'checkmark-done-outline'}
          variant="ghost"
          onPress={selection.active ? selection.exit : selection.start}
          disabled={tracks.length === 0}
          style={{ flex: 1 }}
        />
        <Button
          label="Renomear em massa"
          icon="text-outline"
          variant="ghost"
          onPress={() => setBulkRenaming(true)}
          disabled={tracks.length === 0}
          style={{ flex: 1 }}
        />
      </View>

      <View style={styles.groupsSection}>
        <View style={styles.groupsHeader}>
          <View style={{ flex: 1 }}><Text style={styles.groupsTitle}>Grupos</Text><Text style={styles.groupsHint}>Músicas de um grupo tocam sempre em sequência.</Text></View>
        </View>
        <Button label="Criar grupo" icon="albums-outline" variant="secondary" onPress={() => setCreatingGroup(true)} disabled={tracks.length < 2} />
        {(playlist.groups ?? []).length > 0 ? (playlist.groups ?? []).map((group) => (
          <View key={group.id} style={styles.groupItem}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.groupTitleRow}>
                <Ionicons name="albums-outline" size={18} color={colors.accent} />
                <View style={{ flex: 1, minWidth: 0 }}><Text style={styles.groupName}>{group.name}</Text><Text style={styles.groupCount}>{group.trackIds.length} músicas · reprodução em sequência</Text></View>
                <Pressable onPress={() => Alert.alert(group.name, 'O que deseja fazer?', [
                  { text: 'Cancelar', style: 'cancel' },
                  { text: 'Renomear', onPress: () => { setGroupName(group.name); setRenamingGroupId(group.id); } },
                  { text: 'Desfazer grupo', style: 'destructive', onPress: () => useLibrary.getState().deleteTrackGroup(playlist.id, group.id) },
                ])} hitSlop={10}><Ionicons name="ellipsis-vertical" size={19} color={colors.muted} /></Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.groupTracks}>
                {group.trackIds.map((trackId) => {
                  const groupedTrack = byId.get(trackId);
                  if (!groupedTrack) return null;
                  return <View key={trackId} style={styles.groupTrackMini}>
                    <Cover uri={groupedTrack.coverUrl} seed={groupedTrack.title} size={38} radius={6} />
                    <Text numberOfLines={1} style={styles.groupTrackMiniName}>{groupedTrack.title}</Text>
                  </View>;
                })}
              </ScrollView>
            </View>
          </View>
        )) : <Text style={styles.noGroups}>Nenhum grupo criado.</Text>}
      </View>

      <View style={{ marginTop: spacing.md }}>
        {tracks.length === 0 ? (
          <EmptyState
            icon="musical-notes-outline"
            title="Playlist vazia"
            text="Adicione músicas da sua biblioteca a esta playlist."
          />
        ) : selection.active ? (
          visibleTracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              playlistId={playlist.id}
              onPress={playTrack}
              selectionMode
              selected={selection.selected.has(track.id)}
              onToggleSelect={selection.toggle}
            />
          ))
        ) : (
          visibleTracks.map((track, index) => (
            <DragReorderRow
              key={track.id}
              index={index}
              count={visibleTracks.length}
              onPreviewMove={onPreviewMove}
              onDrop={onDrop}
            >
              <TrackRow track={track} playlistId={playlist.id} onPress={playTrack} />
            </DragReorderRow>
          ))
        )}
      </View>

      <Modal visible={renamingGroupId !== null} transparent animationType="fade" onRequestClose={() => setRenamingGroupId(null)}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={keyboard.onLayout} />
        <Pressable style={styles.modalBackdrop} onPress={() => setRenamingGroupId(null)} />
        <View style={[styles.renameGroupSheet, keyboard.offset > 0 && { top: undefined, bottom: keyboard.offset + spacing.md }]}>
          <Text style={styles.pickerTitle}>Renomear grupo</Text>
          <TextInput value={groupName} onChangeText={setGroupName} autoFocus maxLength={50} placeholder="Nome do grupo" placeholderTextColor={colors.faint} style={styles.groupNameInput} />
          <View style={styles.renameGroupActions}>
            <Button label="Cancelar" variant="secondary" onPress={() => setRenamingGroupId(null)} style={{ flex: 1 }} />
            <Button label="Salvar" disabled={!groupName.trim()} onPress={() => { if (renamingGroupId) useLibrary.getState().renameTrackGroup(playlist.id, renamingGroupId, groupName); setRenamingGroupId(null); }} style={{ flex: 1 }} />
          </View>
        </View>
      </Modal>

      <TrackPickerModal
        visible={addingTracks}
        onClose={() => setAddingTracks(false)}
        tracks={allTracks}
        existingIds={existingIds}
        onConfirm={(ids) => useLibrary.getState().addTracksToPlaylist(playlist.id, ids)}
      />

      <GroupCreatorModal visible={creatingGroup} onClose={() => setCreatingGroup(false)} playlist={playlist} tracks={tracks} />
      <BulkRenameModal visible={bulkRenaming} onClose={() => setBulkRenaming(false)} tracks={tracks} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  topActions: { flexDirection: 'row', gap: 8 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', gap: 6, marginBottom: spacing.lg },
  coverButton: { width: 170, height: 170, borderRadius: 16 },
  coverEdit: { position: 'absolute', right: 9, bottom: 9, width: 36, height: 36, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.6, textAlign: 'center', marginTop: spacing.md },
  nameEditor: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.md },
  nameInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 18, fontWeight: '700', backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 12, minHeight: 44, textAlign: 'center' },
  nameAction: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  cancelName: { backgroundColor: colors.surfaceHigh },
  meta: { color: colors.muted, fontSize: 14 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  renameGroupSheet: { position: 'absolute', left: spacing.md, right: spacing.md, top: '35%', backgroundColor: colors.surface, borderRadius: 16, padding: spacing.md },
  renameGroupActions: { flexDirection: 'row', gap: 10 },
  groupsSection: { marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.surface, borderRadius: 14, gap: 10 },
  groupsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupsTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  groupsHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  groupItem: { paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  groupTracks: { gap: 10, paddingTop: 10, paddingLeft: 28, paddingRight: 4 },
  groupTrackMini: { width: 58, alignItems: 'center', gap: 4 },
  groupTrackMiniName: { color: colors.muted, fontSize: 10, width: 58, textAlign: 'center' },
  groupName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  groupCount: { color: colors.muted, fontSize: 11 },
  noGroups: { color: colors.faint, fontSize: 13, paddingVertical: 4 },
  groupNameInput: { color: colors.text, backgroundColor: colors.surfaceHigh, borderRadius: 10, paddingHorizontal: 14, minHeight: 46, marginVertical: 10 },
  groupSelectRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  groupSelectTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  groupSelectArtist: { color: colors.muted, fontSize: 12 },
  modalBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  trackPicker: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.lg },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  pickerTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  pickerSearch: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 13, minHeight: 44, marginBottom: spacing.sm },
  pickerSearchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 8 },
  pickerList: { flexShrink: 1 },
  pickerTrack: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 },
  pickerTrackName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  pickerTrackArtist: { color: colors.muted, fontSize: 12 },
  pickerEmpty: { color: colors.muted, textAlign: 'center', paddingVertical: spacing.lg },
});
