import type { Track } from '@/store/library-store';

export type TitleChange = { id: string; before: string; after: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Remove `text` do título (sem diferenciar maiúsculas) e limpa o que sobra: espaços duplos, "-" nas pontas, "()" vazios. */
export function removeFromTitle(title: string, text: string): string {
  const needle = text.trim();
  if (!needle) return title;
  const cleaned = title
    .replace(new RegExp(escapeRegExp(needle), 'gi'), ' ')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|·,.]+|[\s\-–—:|·,]+$/g, '')
    .trim();
  return cleaned;
}

/** Prévia da renomeação em massa. Títulos que ficariam vazios são ignorados (a faixa mantém o nome). */
export function previewRemoveText(tracks: Track[], text: string): TitleChange[] {
  if (!text.trim()) return [];
  const changes: TitleChange[] = [];
  for (const track of tracks) {
    const after = removeFromTitle(track.title, text);
    if (after && after !== track.title) changes.push({ id: track.id, before: track.title, after });
  }
  return changes;
}
