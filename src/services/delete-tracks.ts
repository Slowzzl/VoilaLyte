import { Alert } from 'react-native';

import { notify } from '@/lib/notify';
import { deleteCoverFile, deleteLocalFile } from '@/services/files';
import { useLibrary, type Track } from '@/store/library-store';
import { usePlayer } from '@/store/player-store';

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Apaga arquivos de áudio/capa em lotes pequenos, cedendo a thread entre eles para a UI não congelar. */
async function cleanupFiles(doomed: Track[]): Promise<void> {
  const { tracks, playlists } = useLibrary.getState();
  // Arquivo/capa ainda usado por outra faixa ou playlist (capas de ZIP são compartilhadas) não pode ser apagado.
  const keepFiles = new Set<string>();
  const keepCovers = new Set<string>();
  for (const track of tracks) {
    if (track.fileName) keepFiles.add(track.fileName);
    if (track.coverUrl) keepCovers.add(track.coverUrl);
  }
  for (const playlist of playlists) if (playlist.coverUrl) keepCovers.add(playlist.coverUrl);

  for (let index = 0; index < doomed.length; index++) {
    const track = doomed[index];
    if (track.fileName && !keepFiles.has(track.fileName)) deleteLocalFile(track.fileName);
    if (track.coverUrl && !keepCovers.has(track.coverUrl)) deleteCoverFile(track.coverUrl);
    if (index % 15 === 14) await yieldToUi();
  }
}

/** Exclui da biblioteca agora: a interface atualiza na hora; os arquivos são apagados em segundo plano. */
export function deleteTracksNow(trackIds: string[]): void {
  if (trackIds.length === 0) return;
  const wanted = new Set(trackIds);
  const doomed = useLibrary.getState().tracks.filter((track) => wanted.has(track.id));
  usePlayer.getState().removeTracks(trackIds);
  useLibrary.getState().removeTracks(trackIds);
  void cleanupFiles(doomed).catch((error: unknown) => console.warn('Não foi possível apagar alguns arquivos.', error));
  notify(doomed.length === 1 ? 'Música excluída' : `${doomed.length} músicas excluídas`);
}

export function confirmDeleteTracks(trackIds: string[], onDone?: () => void): void {
  if (trackIds.length === 0) return;
  const single = trackIds.length === 1
    ? useLibrary.getState().tracks.find((track) => track.id === trackIds[0])
    : undefined;
  Alert.alert(
    single ? 'Excluir da biblioteca' : `Excluir ${trackIds.length} músicas`,
    single
      ? `"${single.title}" será removida de todas as playlists e o arquivo importado será apagado.`
      : `${trackIds.length} músicas serão removidas da biblioteca e de todas as playlists, e os arquivos serão apagados. Essa ação não pode ser desfeita.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: () => {
          deleteTracksNow(trackIds);
          onDone?.();
        },
      },
    ],
  );
}

export function confirmRemoveFromPlaylist(playlistId: string, playlistName: string, trackIds: string[], onDone?: () => void): void {
  if (trackIds.length === 0) return;
  Alert.alert(
    trackIds.length === 1 ? 'Remover da playlist' : `Remover ${trackIds.length} músicas`,
    `${trackIds.length === 1 ? 'A música sairá' : 'As músicas sairão'} de "${playlistName}". ${trackIds.length === 1 ? 'Ela continua' : 'Elas continuam'} na biblioteca.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: () => {
          useLibrary.getState().removeTracksFromPlaylist(playlistId, trackIds);
          notify(trackIds.length === 1 ? 'Música removida da playlist' : `${trackIds.length} músicas removidas da playlist`);
          onDone?.();
        },
      },
    ],
  );
}
