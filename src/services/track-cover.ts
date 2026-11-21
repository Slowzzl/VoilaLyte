import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { notify } from '@/lib/notify';
import { deleteCoverFile, filesSupported, musicDirectory } from '@/services/files';
import { useLibrary } from '@/store/library-store';
import { updateLockScreenMetadata, usePlayer } from '@/store/player-store';
import { useStats } from '@/store/stats-store';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Abre o seletor de imagens e guarda uma cópia na pasta do app. Devolve o URI salvo, ou null se cancelou. */
async function pickCoverImage(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: IMAGE_TYPES,
    copyToCacheDirectory: true,
    base64: Platform.OS === 'web',
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  const extension = asset.name.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase();
  const mimeType = asset.mimeType ?? (extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg');
  if (!extension && !IMAGE_TYPES.includes(mimeType)) throw new Error('Selecione uma imagem JPG, PNG ou WEBP.');

  if (!filesSupported) {
    if (!asset.base64) throw new Error('Não foi possível ler a imagem selecionada.');
    return `data:${mimeType};base64,${asset.base64}`;
  }

  const safeExtension = extension === 'jpeg' ? 'jpg' : extension ?? mimeType.split('/')[1];
  const destination = new File(musicDirectory(), `cover-custom-${Crypto.randomUUID()}.${safeExtension}`);
  await new File(asset.uri).copy(destination);
  return destination.uri;
}

/** Aplica (ou remove, com null) a capa e atualiza tudo o que mostra a faixa: biblioteca, fila, estatísticas e tela de bloqueio. */
export function applyTrackCover(trackId: string, coverUrl: string | null): void {
  const library = useLibrary.getState();
  const before = library.tracks.find((track) => track.id === trackId);
  if (!before) return;

  library.setTrackCover(trackId, coverUrl);

  const updated = useLibrary.getState().tracks.find((track) => track.id === trackId);
  if (updated) {
    usePlayer.getState().renameTrack(updated); // troca o objeto da faixa na fila/atual
    useStats.getState().renameTrack(updated);
    updateLockScreenMetadata(updated);
  }

  // Apaga a capa antiga se ficou sem uso (capas de ZIP podem ser compartilhadas com outras faixas/playlists).
  if (before.coverUrl && before.coverUrl !== coverUrl) {
    const { tracks, playlists } = useLibrary.getState();
    const stillUsed = tracks.some((track) => track.coverUrl === before.coverUrl)
      || playlists.some((playlist) => playlist.coverUrl === before.coverUrl);
    if (!stillUsed) deleteCoverFile(before.coverUrl);
  }
}

/** Escolhe uma imagem e a define como capa da faixa. Devolve true se a capa foi trocada. */
export async function changeTrackCover(trackId: string): Promise<boolean> {
  const uri = await pickCoverImage();
  if (!uri) return false;
  applyTrackCover(trackId, uri);
  notify('Capa atualizada');
  return true;
}

export function removeTrackCover(trackId: string): void {
  applyTrackCover(trackId, null);
  notify('Capa removida');
}
