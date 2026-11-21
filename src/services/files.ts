import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/** No web não há sistema de arquivos: as músicas tocam direto da URL de origem. */
export const filesSupported = Platform.OS !== 'web';

export function ensureMusicDirectory(): string {
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir.uri;
}

function musicDir(): Directory {
  ensureMusicDirectory();
  return new Directory(Paths.document, 'music');
}

export function musicDirectory(): Directory {
  return musicDir();
}

/**
 * Guardamos só o nome do arquivo (e não o caminho completo), porque o diretório
 * do app pode mudar entre atualizações no iOS.
 */
export function localUri(fileName: string | null): string | null {
  if (!fileName || !filesSupported) return null;
  try {
    const file = new File(musicDir(), fileName);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function playableUri(track: { fileName: string | null; sourceUrl: string }): string {
  return localUri(track.fileName) ?? track.sourceUrl;
}

export function deleteLocalFile(fileName: string | null): void {
  if (!fileName || !filesSupported) return;
  try {
    const file = new File(musicDir(), fileName);
    if (file.exists) file.delete();
  } catch {
    // nada a fazer
  }
}


/** Apaga um arquivo de capa guardado na pasta de músicas (capas de fora dela, como URLs, nunca são tocadas). */
export function deleteCoverFile(uri: string | null): void {
  if (!uri || !filesSupported || !/\/music\/cover-[^/]+$/i.test(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // nada a fazer
  }
}
