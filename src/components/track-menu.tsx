import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { openAddToPlaylists } from '@/components/add-to-playlists';
import { Cover } from '@/components/cover';
import { colors, radius, spacing } from '@/constants/theme';
import { useKeyboardOffset } from '@/lib/layout';
import { confirmDeleteTracks } from '@/services/delete-tracks';
import { changeTrackCover, removeTrackCover } from '@/services/track-cover';
import { useLibrary, type Track } from '@/store/library-store';
import { updateLockScreenMetadata, usePlayer } from '@/store/player-store';
import { useStats } from '@/store/stats-store';

type MenuState = {
  track: Track | null;
  playlistId: string | null;
  open: (track: Track, playlistId?: string) => void;
  close: () => void;
};

const useMenu = create<MenuState>()((set) => ({
  track: null,
  playlistId: null,
  open: (track, playlistId) => set({ track, playlistId: playlistId ?? null }),
  close: () => set({ track: null, playlistId: null }),
}));

export function openTrackMenu(track: Track, playlistId?: string) {
  useMenu.getState().open(track, playlistId);
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function Action({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={danger ? colors.danger : colors.text} />
      <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

/** Menu de ações de uma faixa (segurar a linha ou tocar nos três pontinhos). */
export function TrackMenu() {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOffset();
  const { track, playlistId, close } = useMenu();
  const playlists = useLibrary((s) => s.playlists);
  const libraryTracks = useLibrary((s) => s.tracks);
  const selectedPlaylist = playlists.find((item) => item.id === playlistId) ?? null;
  const playlistTracks = selectedPlaylist ? selectedPlaylist.trackIds.map((id) => libraryTracks.find((item) => item.id === id)).filter((item): item is Track => !!item) : [];
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renamingArtist, setRenamingArtist] = useState(false);
  const [newArtist, setNewArtist] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupTrackIds, setGroupTrackIds] = useState<string[]>([]);

  const dismiss = () => {
    setRenaming(false);
    setNewTitle('');
    setRenamingArtist(false);
    setNewArtist('');
    setCreatingGroup(false);
    setGroupName('');
    setGroupTrackIds([]);
    close();
  };

  if (!track) return null;
  const current = track;

  // Várias playlists de uma vez: abre a folha própria depois que este menu terminar de fechar.
  const addToPlaylists = () => {
    dismiss();
    openAddToPlaylists([current.id], { delayMs: 300 });
  };

  const replaceCover = () => {
    dismiss();
    // O seletor de arquivos só abre com segurança depois que este Modal fechou.
    setTimeout(() => {
      changeTrackCover(current.id).catch((error: unknown) =>
        Alert.alert('Capa da música', error instanceof Error ? error.message : 'Não foi possível trocar a capa.'));
    }, 300);
  };

  const saveTrackName = () => {
    try {
      useLibrary.getState().renameTrack(current.id, newTitle);
      const updatedTrack = useLibrary.getState().tracks.find((item) => item.id === current.id);
      if (updatedTrack) {
        usePlayer.getState().renameTrack(updatedTrack);
        useStats.getState().renameTrack(updatedTrack);
        updateLockScreenMetadata(updatedTrack);
      }
      dismiss();
    } catch (error) {
      Alert.alert('Renomear música', error instanceof Error ? error.message : 'Não foi possível renomear a música.');
    }
  };

  const saveArtistName = () => {
    try {
      useLibrary.getState().renameArtist(current.id, newArtist);
      const updatedTrack = useLibrary.getState().tracks.find((item) => item.id === current.id);
      if (updatedTrack) {
        usePlayer.getState().renameTrack(updatedTrack);
        useStats.getState().renameArtist(updatedTrack);
        updateLockScreenMetadata(updatedTrack);
      }
      dismiss();
    } catch (error) {
      Alert.alert('Renomear artista', error instanceof Error ? error.message : 'Não foi possível renomear o artista.');
    }
  };

  const saveTrackGroup = () => {
    if (!playlistId) return;
    try {
      useLibrary.getState().createTrackGroup(playlistId, groupName, groupTrackIds);
      dismiss();
    } catch (error) {
      Alert.alert('Criar grupo', error instanceof Error ? error.message : 'Não foi possível criar o grupo.');
    }
  };

  const confirmDelete = () => confirmDeleteTracks([current.id], dismiss);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={keyboard.onLayout} />
      <Pressable style={styles.backdrop} onPress={dismiss} />
      <View style={[styles.sheet, { bottom: keyboard.offset, paddingBottom: keyboard.offset > 0 ? spacing.md : insets.bottom + spacing.md }]}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Cover uri={current.coverUrl} seed={current.title} size={48} radius={8} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.title}>{current.title}</Text>
            <Text numberOfLines={1} style={styles.artist}>{current.artist}</Text>
          </View>
        </View>

        {creatingGroup ? (
          <View style={{ maxHeight: 430 }}>
            <Text style={styles.pickTitle}>Criar grupo nesta playlist</Text>
            <TextInput value={groupName} onChangeText={setGroupName} placeholder="Nome do grupo" placeholderTextColor={colors.faint} style={styles.input} maxLength={50} autoFocus />
            <Text style={styles.groupHint}>Selecione pelo menos duas músicas. Elas tocarão juntas, inclusive no aleatório.</Text>
            <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
              {playlistTracks.map((item) => {
                const selected = groupTrackIds.includes(item.id);
                const belongsToGroup = (selectedPlaylist?.groups ?? []).some((group) => group.trackIds.includes(item.id));
                return <Pressable key={item.id} disabled={belongsToGroup} onPress={() => setGroupTrackIds((ids) => selected ? ids.filter((id) => id !== item.id) : [...ids, item.id])} style={styles.groupPickRow}>
                  <Ionicons name={belongsToGroup ? 'lock-closed-outline' : selected ? 'checkbox' : 'square-outline'} size={20} color={belongsToGroup ? colors.faint : selected ? colors.accent : colors.muted} />
                  <Cover uri={item.coverUrl} seed={item.title} size={36} radius={6} />
                  <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={styles.pickName}>{item.title}</Text><Text numberOfLines={1} style={styles.artist}>{item.artist}</Text></View>
                  {belongsToGroup ? <Text style={styles.groupHint}>Agrupada</Text> : null}
                </Pressable>;
              })}
            </ScrollView>
            <View style={styles.newRow}>
              <Pressable onPress={() => { setCreatingGroup(false); setGroupTrackIds([]); }} style={[styles.cancelButton, { flex: 1 }]}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
              <Pressable disabled={!groupName.trim() || groupTrackIds.length < 2} onPress={saveTrackGroup} style={[styles.createButton, { flex: 1, opacity: !groupName.trim() || groupTrackIds.length < 2 ? 0.45 : 1 }]}><Text style={styles.createText}>Criar grupo ({groupTrackIds.length})</Text></Pressable>
            </View>
          </View>
        ) : renamingArtist ? (
          <View style={styles.newRow}>
            <TextInput value={newArtist} onChangeText={setNewArtist} placeholder="Nome do artista" placeholderTextColor={colors.faint} style={styles.input} maxLength={120} autoFocus returnKeyType="done" onSubmitEditing={saveArtistName} />
            <Pressable onPress={saveArtistName} accessibilityLabel="Salvar artista" style={styles.createButton}><Ionicons name="checkmark" size={20} color={colors.onAccent} /></Pressable>
            <Pressable onPress={() => setRenamingArtist(false)} accessibilityLabel="Cancelar" style={styles.cancelButton}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
          </View>
        ) : renaming ? (
          <View style={styles.newRow}>
            <TextInput
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Nome da música"
              placeholderTextColor={colors.faint}
              style={styles.input}
              maxLength={120}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveTrackName}
            />
            <Pressable onPress={saveTrackName} accessibilityLabel="Salvar nome" style={styles.createButton}>
              <Ionicons name="checkmark" size={20} color={colors.onAccent} />
            </Pressable>
            <Pressable onPress={() => setRenaming(false)} accessibilityLabel="Cancelar" style={styles.cancelButton}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
            <Action icon="play-forward-outline" label="Tocar em seguida" onPress={() => { usePlayer.getState().playNext(current); dismiss(); }} />
            <Action icon="list-outline" label="Adicionar à fila" onPress={() => { usePlayer.getState().addToQueue(current); dismiss(); }} />
            <Action icon="add-circle-outline" label="Adicionar a playlists" onPress={addToPlaylists} />
            <Action icon="image-outline" label="Trocar capa" onPress={replaceCover} />
            {current.coverUrl ? <Action icon="close-circle-outline" label="Remover capa" onPress={() => { removeTrackCover(current.id); dismiss(); }} /> : null}
            <Action icon="create-outline" label="Renomear música" onPress={() => { setNewTitle(current.title); setRenaming(true); }} />
            <Action icon="person-outline" label="Renomear artista" onPress={() => { setNewArtist(current.artist); setRenamingArtist(true); }} />
            {playlistId ? <Action icon="albums-outline" label="Criar grupo com músicas desta playlist" onPress={() => { setGroupName(''); setGroupTrackIds([current.id]); setCreatingGroup(true); }} /> : null}
            {playlistId ? (
              <Action
                icon="remove-circle-outline"
                label="Remover desta playlist"
                onPress={() => { useLibrary.getState().removeTracksFromPlaylist(playlistId, [current.id]); dismiss(); }}
              />
            ) : null}
            <Action icon="trash-outline" label="Excluir da biblioteca" danger onPress={confirmDelete} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginBottom: 4 },
  title: { color: colors.text, fontSize: 16, fontWeight: '800' },
  artist: { color: colors.muted, fontSize: 13, marginTop: 2 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 14 },
  actionLabel: { color: colors.text, fontSize: 16, fontWeight: '600' },
  pickTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 10, marginBottom: 6 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  pickName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  newRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  input: { flex: 1, color: colors.text, backgroundColor: colors.surfaceHigh, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 44 },
  createButton: { backgroundColor: colors.accent, borderRadius: radius.md, paddingHorizontal: 18, justifyContent: 'center' },
  cancelButton: { backgroundColor: colors.surfaceHigh, borderRadius: radius.md, width: 44, alignItems: 'center', justifyContent: 'center' },
  createText: { color: colors.onAccent, fontWeight: '800', textAlign: 'center' },
  cancelText: { color: colors.text, fontWeight: '700' },
  groupHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 7, marginBottom: 5 },
  groupPickRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
