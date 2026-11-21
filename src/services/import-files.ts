import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { Platform } from 'react-native';

import { useLibrary, type NewTrack, type Track } from '@/store/library-store';

const SINGLE_FILE_EXT = /\.mp3$/i;
const ZIP_AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|aif|aiff)$/i;
const ZIP_IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const READ_CHUNK_SIZE = 256 * 1024;
const MAX_ZIP_ARTWORK_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_ARTWORK_FILES = 64;

export interface ImportResult {
  playlistId: string | null;
  imported: Track[];
  skipped: number;
  errors: string[];
}

function musicDir(): Directory {
  const dir = new Directory(Paths.document, 'music');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileExtension(path: string): string {
  return path.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() ?? 'mp3';
}

function parseTrackMeta(path: string): { title: string; artist: string } {
  const base = path.split('/').pop()?.replace(/\.[a-z0-9]{2,5}$/i, '') ?? '';
  const cleaned = base.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  const index = cleaned.indexOf(' - ');
  if (index > 0) return { artist: cleaned.slice(0, index).trim(), title: cleaned.slice(index + 3).trim() };
  return { artist: 'Artista desconhecido', title: cleaned || 'Faixa sem título' };
}

function inputFor(path: string, sourceUrl: string, coverUrl: string | null = null): NewTrack {
  const { title, artist } = parseTrackMeta(path);
  return {
    title,
    artist,
    album: '',
    coverUrl,
    durationMs: 0,
    sourceUrl,
  };
}

function syncSafeSize(bytes: Uint8Array): number {
  return ((bytes[0] & 0x7f) << 21) | ((bytes[1] & 0x7f) << 14) | ((bytes[2] & 0x7f) << 7) | (bytes[3] & 0x7f);
}

function bigEndianSize(bytes: Uint8Array): number {
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

async function extractMp3Artwork(audioFile: File, audioDigest: string): Promise<string | null> {
  const input = audioFile.open(FileMode.ReadOnly);
  let output: ReturnType<File['open']> | null = null;
  let artwork: File | null = null;
  try {
    const header = await input.readBytes(10);
    if (header.length !== 10 || ascii(header.subarray(0, 3)) !== 'ID3') return null;
    const version = header[3];
    if ((version !== 3 && version !== 4) || (header[5] & 0x80) !== 0) return null;

    const tagEnd = 10 + syncSafeSize(header.subarray(6, 10));
    let frameOffset = 10;
    if ((header[5] & 0x40) !== 0) {
      input.offset = 10;
      const extendedSizeBytes = await input.readBytes(4);
      if (extendedSizeBytes.length !== 4) return null;
      const extendedSize = version === 3 ? bigEndianSize(extendedSizeBytes) : syncSafeSize(extendedSizeBytes);
      frameOffset = version === 3 ? 14 + extendedSize : 10 + extendedSize;
    }

    while (frameOffset + 10 <= tagEnd) {
      input.offset = frameOffset;
      const frameHeader = await input.readBytes(10);
      if (frameHeader.length !== 10) return null;
      const frameId = ascii(frameHeader.subarray(0, 4));
      if (!frameId.trim() || frameId.startsWith('\0')) return null;
      const frameSize = version === 3 ? bigEndianSize(frameHeader.subarray(4, 8)) : syncSafeSize(frameHeader.subarray(4, 8));
      const frameStart = frameOffset + 10;
      const frameEnd = frameStart + frameSize;
      if (frameSize <= 0 || frameEnd > tagEnd) return null;

      if (frameId === 'APIC' && frameHeader[9] === 0) {
        input.offset = frameStart;
        const encoding = (await input.readBytes(1))[0];
        const mimeBytes: number[] = [];
        for (let count = 0; count < 256 && input.offset! < frameEnd; count++) {
          const value = (await input.readBytes(1))[0];
          if (value === 0) break;
          mimeBytes.push(value);
        }
        const mimeType = ascii(new Uint8Array(mimeBytes)).toLowerCase();
        await input.readBytes(1); // picture type

        const terminatorWidth = encoding === 1 || encoding === 2 ? 2 : 1;
        let foundTerminator = false;
        for (let scanned = 0; scanned < 8192 && input.offset! + terminatorWidth <= frameEnd; scanned += terminatorWidth) {
          const codeUnit = await input.readBytes(terminatorWidth);
          if (codeUnit.length !== terminatorWidth) break;
          if (codeUnit.every((byte) => byte === 0)) {
            foundTerminator = true;
            break;
          }
        }
        if (!foundTerminator) return null;

        const extension = mimeType === 'image/jpeg' || mimeType === 'image/jpg'
          ? 'jpg'
          : mimeType === 'image/png'
            ? 'png'
            : mimeType === 'image/webp'
              ? 'webp'
              : null;
        if (!extension) return null;

        let remaining = frameEnd - input.offset!;
        if (remaining <= 0 || remaining > MAX_ZIP_ARTWORK_BYTES) return null;
        artwork = new File(musicDir(), `cover-${audioDigest}.${extension}`);
        if (artwork.exists) return artwork.uri;
        artwork.create();
        output = artwork.open(FileMode.WriteOnly);
        while (remaining > 0) {
          const chunk = await input.readBytes(Math.min(READ_CHUNK_SIZE, remaining));
          if (chunk.length === 0) throw new Error('Tag de capa ID3 incompleta.');
          await output.writeBytes(chunk);
          remaining -= chunk.length;
        }
        output.close();
        output = null;
        return artwork.uri;
      }

      frameOffset = frameEnd;
    }
    return null;
  } catch {
    if (artwork?.exists) artwork.delete();
    return null;
  } finally {
    output?.close();
    input.close();
  }
}

async function importSingleMp3(uri: string, name: string): Promise<{ track: Track; isNew: boolean }> {
  const source = new File(uri);
  const stagedFile = new File(musicDir(), `.import-${Crypto.randomUUID()}.tmp`);
  try {
    await source.copy(stagedFile);
    const digest = await stagedFile.digest('SHA-256');
    const coverUrl = await extractMp3Artwork(stagedFile, digest);
    const sourceUrl = `file-sha256:${digest}`;
    const existing = useLibrary.getState().tracks.find((track) => track.sourceUrl === sourceUrl);
    const fileName = existing?.fileName ?? `${digest}.mp3`;
    const destination = new File(musicDir(), fileName);
    if (destination.exists) stagedFile.delete();
    else await stagedFile.move(destination);

    const beforeIds = new Set(useLibrary.getState().tracks.map((track) => track.id));
    const [track] = useLibrary.getState().upsertTracks([inputFor(name, sourceUrl, coverUrl)]);
    useLibrary.getState().setTrackFile(track.id, fileName);
    if (coverUrl) useLibrary.getState().setTrackCover(track.id, coverUrl);
    return { track, isNew: !beforeIds.has(track.id) };
  } catch (error) {
    if (stagedFile.exists) stagedFile.delete();
    throw error;
  }
}

type ExtractedAudio = { path: string; digest: string; stagedFile: File; order: number };
type ExtractedImage = { path: string; digest: string; stagedFile: File; order: number };
type StreamingEntry = {
  path: string;
  order: number;
  kind: 'audio' | 'image';
  stagedFile: File;
  writer: WritableStreamDefaultWriter<Uint8Array<ArrayBufferLike>>;
  pending: Promise<void>;
  error?: Error;
  finished: boolean;
};

async function extractZipToFiles(archive: File): Promise<{ audioFiles: ExtractedAudio[]; images: ExtractedImage[]; errors: string[] }> {
  const stagedEntries: StreamingEntry[] = [];
  const audioFiles: ExtractedAudio[] = [];
  const images: ExtractedImage[] = [];
  const errors: string[] = [];
  let order = 0;
  let imageCount = 0;

  const unzip = new Unzip((entry) => {
    if (entry.name.startsWith('__MACOSX/')) return;
    const kind = ZIP_AUDIO_EXT.test(entry.name) ? 'audio' : ZIP_IMAGE_EXT.test(entry.name) ? 'image' : null;
    if (!kind) return;
    if (kind === 'image' && ((entry.originalSize ?? 0) > MAX_ZIP_ARTWORK_BYTES || imageCount >= MAX_ZIP_ARTWORK_FILES)) return;
    if (kind === 'image') imageCount++;

    const stagedFile = new File(musicDir(), `.zip-entry-${Crypto.randomUUID()}.tmp`);
    stagedFile.create();
    const state: StreamingEntry = {
      path: entry.name,
      order: order++,
      kind,
      stagedFile,
      writer: stagedFile.writableStream().getWriter(),
      pending: Promise.resolve(),
      finished: false,
    };
    stagedEntries.push(state);

    const recordFailure = (cause: unknown) => {
      state.error = cause instanceof Error ? cause : new Error('Falha ao descompactar a faixa.');
    };

    entry.ondata = (error, chunk, final) => {
      if (error) {
        recordFailure(error);
        return;
      }
      if (chunk.length > 0) {
        state.pending = state.pending
          .then(() => state.writer.write(chunk))
          .then(() => undefined)
          .catch(recordFailure);
      }
      if (final) {
        state.pending = state.pending
          .then(async () => {
            if (state.error) throw state.error;
            await state.writer.close();
            const digest = await stagedFile.digest('SHA-256');
            if (state.kind === 'audio') audioFiles.push({ path: state.path, digest, stagedFile, order: state.order });
            else images.push({ path: state.path, digest, stagedFile, order: state.order });
            state.finished = true;
          })
          .catch(recordFailure);
      }
    };

    try {
      entry.start();
    } catch (error) {
      recordFailure(error);
    }
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);

  const input = archive.open(FileMode.ReadOnly);
  try {
    while (true) {
      const chunk = await input.readBytes(READ_CHUNK_SIZE);
      if (chunk.length === 0) break;
      unzip.push(chunk, false);
      await Promise.all(stagedEntries.map((entry) => entry.pending));
      const failed = stagedEntries.find((entry) => entry.error);
      if (failed) throw failed.error;
    }

    unzip.push(new Uint8Array(0), true);
    await Promise.all(stagedEntries.map((entry) => entry.pending));
    const failed = stagedEntries.find((entry) => entry.error);
    if (failed) throw failed.error;
    return {
      audioFiles: audioFiles.sort((left, right) => left.order - right.order),
      images: images.sort((left, right) => left.order - right.order),
      errors,
    };
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'ZIP inválido ou não suportado.');
    for (const file of [...audioFiles, ...images]) {
      if (file.stagedFile.exists) file.stagedFile.delete();
    }
    return { audioFiles: [], images: [], errors };
  } finally {
    input.close();
    for (const entry of stagedEntries) {
      if (!entry.finished) {
        try {
          await entry.writer.abort();
        } catch {
          // Writer can already be closed or errored.
        }
        if (entry.stagedFile.exists) entry.stagedFile.delete();
      }
    }
  }
}

function artworkForAudio(audioPath: string, images: ExtractedImage[]): ExtractedImage | undefined {
  if (images.length === 0) return undefined;
  const parts = audioPath.split('/');
  const audioName = parts.pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
  const directory = parts.join('/');
  const localImages = images.filter((image) => image.path.split('/').slice(0, -1).join('/') === directory);
  const imageBase = (image: ExtractedImage) => image.path.split('/').pop()?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
  const genericCover = /^(cover|folder|front|album|artwork)([-_ ]?\d+)?$/i;

  return localImages.find((image) => imageBase(image) === audioName)
    ?? localImages.find((image) => genericCover.test(imageBase(image)))
    ?? localImages[0]
    ?? images.find((image) => image.path.split('/').length === 1 && genericCover.test(imageBase(image)))
    ?? images.find((image) => image.path.split('/').length === 1)
    ?? images[0];
}

async function importZip(uri: string, zipName: string): Promise<ImportResult> {
  const source = new File(uri);
  const stagedArchive = new File(Paths.cache, `.spotylite-${Crypto.randomUUID()}.zip`);
  let extracted: ExtractedAudio[] = [];
  let extractedImages: ExtractedImage[] = [];
  try {
    await source.copy(stagedArchive);
    const archiveDigest = await stagedArchive.digest('SHA-256');
    const result = await extractZipToFiles(stagedArchive);
    extracted = result.audioFiles;
    extractedImages = result.images;

    if (extracted.length === 0) {
      return {
        playlistId: null,
        imported: [],
        skipped: 0,
        errors: result.errors.length > 0 ? result.errors : ['O .zip não contém arquivos de áudio suportados.'],
      };
    }

    const existingBySource = new Map(useLibrary.getState().tracks.map((track) => [track.sourceUrl, track]));
    const uniqueInputs = new Map<string, NewTrack>();
    const fileNames = new Map<string, string>();
    const coverUrls = new Map<string, string>();
    const sourceOrder: string[] = [];
    const errors = [...result.errors];

    for (const audio of extracted) {
      try {
        const sourceUrl = `file-sha256:${audio.digest}`;
        sourceOrder.push(sourceUrl);
        const existing = existingBySource.get(sourceUrl);
        const fileName = existing?.fileName ?? fileNames.get(sourceUrl) ?? `${audio.digest}.${fileExtension(audio.path)}`;
        fileNames.set(sourceUrl, fileName);

        let coverUrl = await extractMp3Artwork(audio.stagedFile, audio.digest);
        const artwork = artworkForAudio(audio.path, extractedImages);
        if (artwork) {
          const coverFileName = `cover-${artwork.digest}.${fileExtension(artwork.path)}`;
          const coverFile = new File(musicDir(), coverFileName);
          if (!coverFile.exists) await artwork.stagedFile.copy(coverFile);
          coverUrl = coverFile.uri;
        }
        if (coverUrl) coverUrls.set(sourceUrl, coverUrl);

        const destination = new File(musicDir(), fileName);
        if (destination.exists) audio.stagedFile.delete();
        else {
          await audio.stagedFile.copy(destination);
          audio.stagedFile.delete();
        }

        if (!existing && !uniqueInputs.has(sourceUrl)) {
          uniqueInputs.set(sourceUrl, inputFor(audio.path, sourceUrl, coverUrl));
        }
      } catch (error) {
        errors.push(`${audio.path}: ${error instanceof Error ? error.message : 'falha ao importar'}`);
        if (audio.stagedFile.exists) audio.stagedFile.delete();
      }
    }

    const beforeIds = new Set(useLibrary.getState().tracks.map((track) => track.id));
    const createdOrReused = useLibrary.getState().upsertTracks([...uniqueInputs.values()]);
    const allTracks = new Map(useLibrary.getState().tracks.map((track) => [track.sourceUrl, track]));
    createdOrReused.forEach((track) => allTracks.set(track.sourceUrl, track));

    const orderedTracks = sourceOrder
      .map((sourceUrl) => allTracks.get(sourceUrl))
      .filter((track): track is Track => track !== undefined);
    const uniqueTracks = [...new Map(orderedTracks.map((track) => [track.id, track])).values()];

    // Uma única atualização para todas as faixas (antes eram 2 por faixa, cada uma percorrendo a biblioteca inteira).
    const patches: Record<string, { fileName?: string; coverUrl?: string }> = {};
    for (const track of uniqueTracks) {
      const fileName = fileNames.get(track.sourceUrl);
      const coverUrl = coverUrls.get(track.sourceUrl);
      if (fileName || coverUrl) patches[track.id] = { ...(fileName ? { fileName } : {}), ...(coverUrl ? { coverUrl } : {}) };
    }
    useLibrary.getState().patchTracks(patches);

    const playlistName = zipName.replace(/\.zip$/i, '').trim() || 'Playlist importada';
    const playlist = useLibrary.getState().createPlaylist({
      name: playlistName,
      sourceUrl: `zip-sha256:${archiveDigest}`,
    });
    const playlistCover = sourceOrder.map((sourceUrl) => coverUrls.get(sourceUrl)).find(Boolean);
    if (playlistCover) useLibrary.getState().setPlaylistCover(playlist.id, playlistCover);
    useLibrary.getState().addTracksToPlaylist(playlist.id, uniqueTracks.map((track) => track.id));

    const imported = uniqueTracks.filter((track) => !beforeIds.has(track.id));
    return {
      playlistId: playlist.id,
      imported,
      skipped: extracted.length - imported.length,
      errors,
    };
  } finally {
    if (stagedArchive.exists) stagedArchive.delete();
    for (const stagedFile of [...extracted, ...extractedImages]) {
      if (stagedFile.stagedFile.exists) stagedFile.stagedFile.delete();
    }
  }
}

export async function pickAndImport(onImportStarted?: () => void): Promise<ImportResult | null> {
  if (Platform.OS === 'web') throw new Error('A importação de arquivos está disponível no app iOS/Android.');

  const result = await DocumentPicker.getDocumentAsync({
    type: ['audio/mpeg', 'application/zip', 'application/x-zip-compressed'],
    multiple: true,
    copyToCacheDirectory: Platform.OS !== 'android',
  });
  if (result.canceled) return null;
  onImportStarted?.();

  const imported: Track[] = [];
  const errors: string[] = [];
  let skipped = 0;
  let playlistId: string | null = null;

  for (const asset of result.assets) {
    try {
      if (/\.zip$/i.test(asset.name)) {
        const importedZip = await importZip(asset.uri, asset.name);
        imported.push(...importedZip.imported);
        skipped += importedZip.skipped;
        errors.push(...importedZip.errors);
        playlistId = importedZip.playlistId ?? playlistId;
      } else if (SINGLE_FILE_EXT.test(asset.name)) {
        const importedFile = await importSingleMp3(asset.uri, asset.name);
        if (importedFile.isNew) imported.push(importedFile.track);
        else skipped += 1;
      } else {
        errors.push(`${asset.name}: selecione um MP3 ou arquivo .zip.`);
      }
    } catch (error) {
      errors.push(`${asset.name}: ${error instanceof Error ? error.message : 'falha ao importar'}`);
    }
  }

  return { playlistId, imported, skipped, errors };
}
