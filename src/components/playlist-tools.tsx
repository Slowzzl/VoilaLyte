import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Cover } from '@/components/cover';
import { Button } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { useKeyboardOffset } from '@/lib/layout';
import { previewRemoveText } from '@/lib/rename';
import { useLibrary, type Playlist, type Track } from '@/store/library-store';
import { updateLockScreenMetadata, usePlayer } from '@/store/player-store';
import { useStats } from '@/store/stats-store';

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOffset();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={keyboard.onLayout} />
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { bottom: keyboard.offset, paddingBottom: keyboard.offset > 0 ? spacing.md : insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Fechar">
            <Ionicons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}

/** Criar grupo (músicas que sempre tocam em sequência) direto da playlist, com botão grande. */
export function GroupCreatorModal({ visible, onClose, playlist, tracks }: { visible: boolean; onClose: () => void; playlist: Playlist; tracks: Track[] }) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const grouped = useMemo(() => new Set((playlist.groups ?? []).flatMap((g) => g.trackIds)), [playlist.groups]);

  const close = () => {
    setName('');
    setSelected([]);
    onClose();
  };
  const canSave = name.trim().length > 0 && selected.length >= 2;
  const save = () => {
    try {
      useLibrary.getState().createTrackGroup(playlist.id, name, selected);
      close();
    } catch (error) {
      Alert.alert('Criar grupo', error instanceof Error ? error.message : 'Não foi possível criar o grupo.');
    }
  };

  return (
    <Sheet visible={visible} onClose={close} title="Novo grupo">
      <TextInput value={name} onChangeText={setName} placeholder="Nome do grupo" placeholderTextColor={colors.faint} style={styles.input} maxLength={50} />
      <Text style={styles.hint}>Escolha pelo menos duas músicas. Elas tocarão sempre juntas, inclusive no aleatório.</Text>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {tracks.map((track) => {
          const locked = grouped.has(track.id);
          const checked = selected.includes(track.id);
          return (
            <Pressable
              key={track.id}
              disabled={locked}
              onPress={() => setSelected((ids) => (checked ? ids.filter((id) => id !== track.id) : [...ids, track.id]))}
              style={[styles.pickRow, locked && { opacity: 0.45 }]}
            >
              <Ionicons name={locked ? 'lock-closed-outline' : checked ? 'checkbox' : 'square-outline'} size={22} color={checked ? colors.accent : colors.muted} />
              <Cover uri={track.coverUrl} seed={track.title} size={40} radius={7} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.pickName}>{track.title}</Text>
                <Text numberOfLines={1} style={styles.pickArtist}>{locked ? 'Já está em outro grupo' : track.artist}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Button label={`Criar grupo (${selected.length})`} icon="albums-outline" onPress={save} disabled={!canSave} />
    </Sheet>
  );
}

/** Remove um texto em comum (ex.: "The", "(Official Video)") do título de todas as músicas da playlist. */
export function BulkRenameModal({ visible, onClose, tracks }: { visible: boolean; onClose: () => void; tracks: Track[] }) {
  const [text, setText] = useState('');
  const changes = useMemo(() => previewRemoveText(tracks, text), [tracks, text]);

  const close = () => {
    setText('');
    onClose();
  };

  const apply = () => {
    const updated = useLibrary.getState().renameTracksBulk(changes.map((c) => ({ id: c.id, after: c.after })));
    for (const track of updated) {
      usePlayer.getState().renameTrack(track);
      useStats.getState().renameTrack(track);
      updateLockScreenMetadata(track);
    }
    close();
    Alert.alert('Renomear em massa', `${updated.length} ${updated.length === 1 ? 'música renomeada' : 'músicas renomeadas'}.`);
  };

  return (
    <Sheet visible={visible} onClose={close} title="Renomear em massa">
      <Text style={styles.hint}>Digite o texto que deve ser removido do nome de todas as músicas desta playlist.</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder='Ex.: The'
        placeholderTextColor={colors.faint}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={80}
      />
      {text.trim() ? (
        <Text style={styles.count}>
          {changes.length === 0 ? 'Nenhuma música contém esse texto.' : `${changes.length} de ${tracks.length} músicas serão alteradas`}
        </Text>
      ) : null}
      <ScrollView style={[styles.list, { maxHeight: 200 }]} keyboardShouldPersistTaps="handled">
        {changes.slice(0, 8).map((change) => (
          <View key={change.id} style={styles.previewRow}>
            <Text numberOfLines={1} style={styles.before}>{change.before}</Text>
            <Ionicons name="arrow-down" size={12} color={colors.faint} />
            <Text numberOfLines={1} style={styles.after}>{change.after}</Text>
          </View>
        ))}
        {changes.length > 8 ? <Text style={styles.hint}>e mais {changes.length - 8}…</Text> : null}
      </ScrollView>
      <Button label={changes.length ? `Remover de ${changes.length} músicas` : 'Remover'} icon="remove-circle-outline" onPress={apply} disabled={changes.length === 0} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: { position: 'absolute', left: 0, right: 0, maxHeight: '88%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  input: { color: colors.text, backgroundColor: colors.surfaceHigh, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 48, fontSize: 15 },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  count: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  list: { maxHeight: 300, flexGrow: 0 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pickName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pickArtist: { color: colors.muted, fontSize: 12 },
  previewRow: { paddingVertical: 6, gap: 2 },
  before: { color: colors.muted, fontSize: 13, textDecorationLine: 'line-through' },
  after: { color: colors.text, fontSize: 14, fontWeight: '700' },
});
