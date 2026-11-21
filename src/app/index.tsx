import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { TrackRow } from '@/components/track-row';
import { Button, EmptyState, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { formatListening, greeting, pluralize } from '@/lib/format';
import { dayKey, rank, summarize, totalAllTime } from '@/lib/stats';
import { useLibrary } from '@/store/library-store';
import { usePlayer } from '@/store/player-store';
import { useStats } from '@/store/stats-store';

export default function HomeScreen() {
  const tracks = useLibrary((s) => s.tracks);
  const playlists = useLibrary((s) => s.playlists);
  const days = useStats((s) => s.days);
  const recentIds = useStats((s) => s.recent);

  const today = useMemo(() => summarize(days, dayKey()), [days]);
  const allTimeMs = useMemo(() => totalAllTime(days), [days]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const recent = recentIds.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t).slice(0, 10);
  const topToday = rank(today.tracks, 'time', 3)
    .map((r) => byId.get(r.key))
    .filter((t): t is NonNullable<typeof t> => !!t);

  if (tracks.length === 0) {
    return (
      <Screen title="Spotylite" subtitle={greeting()}>
        <EmptyState
          icon="musical-notes"
          title="Sua biblioteca está vazia"
          text="Importe arquivos MP3 ou um ZIP com músicas para criar uma playlist."
        >
          <Button label="Importar arquivos" icon="add" onPress={() => router.push('/add')} />
        </EmptyState>
      </Screen>
    );
  }

  return (
    <Screen title="Spotylite" subtitle={greeting()}>
      <Pressable onPress={() => router.push('/stats')} style={styles.hero}>
        <Text style={styles.heroKicker}>OUVIDO HOJE</Text>
        <Text style={styles.heroValue}>{formatListening(today.totalMs)}</Text>
        <View style={styles.heroFooter}>
          <Text style={styles.heroHint}>
            {pluralize(today.plays, 'reprodução', 'reproduções')} · total {formatListening(allTimeMs)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.muted} />
        </View>
      </Pressable>

      {recent.length > 0 ? (
        <>
          <SectionHeader title="Tocadas recentemente" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {recent.map((track) => (
              <Pressable key={track.id} onPress={() => usePlayer.getState().play(track, recent)} style={styles.shelfItem}>
                <Cover uri={track.coverUrl} seed={track.title} size={128} radius={radius.md} />
                <Text numberOfLines={1} style={styles.shelfTitle}>{track.title}</Text>
                <Text numberOfLines={1} style={styles.shelfSub}>{track.artist}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      {topToday.length > 0 ? (
        <>
          <SectionHeader title="Mais ouvidas hoje" action="Ver estatísticas" onAction={() => router.push('/stats')} />
          {topToday.map((track, i) => (
            <TrackRow key={track.id} track={track} rank={i + 1} onPress={() => usePlayer.getState().play(track, topToday)} />
          ))}
        </>
      ) : null}

      {playlists.length > 0 ? (
        <>
          <SectionHeader title="Playlists" action="Ver todas" onAction={() => router.push('/library')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
            {playlists.map((playlist) => (
              <Pressable key={playlist.id} onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: playlist.id } })} style={styles.shelfItem}>
                <Cover uri={playlist.coverUrl} seed={playlist.name} size={128} radius={radius.md} />
                <Text numberOfLines={1} style={styles.shelfTitle}>{playlist.name}</Text>
                <Text numberOfLines={1} style={styles.shelfSub}>{pluralize(playlist.trackIds.length, 'música', 'músicas')}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      <SectionHeader title="Adicionadas por último" />
      {[...tracks].sort((a, b) => b.addedAt - a.addedAt).slice(0, 5).map((track) => (
        <TrackRow key={track.id} track={track} onPress={() => usePlayer.getState().play(track, tracks)} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 4, borderWidth: 1, borderColor: colors.border },
  heroKicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  heroValue: { color: colors.text, fontSize: 44, fontWeight: '800', letterSpacing: -1.5 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroHint: { color: colors.muted, fontSize: 13 },
  shelf: { gap: 14, paddingRight: spacing.md },
  shelfItem: { width: 128, gap: 2 },
  shelfTitle: { color: colors.text, fontSize: 13.5, fontWeight: '700', marginTop: 6 },
  shelfSub: { color: colors.muted, fontSize: 12 },
});
