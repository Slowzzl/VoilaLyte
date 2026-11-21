import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { EmptyState, SectionHeader, Segmented, StatCard } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { formatListening, pluralize } from '@/lib/format';
import { periodKey, periodLabel, rank, shiftPeriod, summarize, totalAllTime, type Period, type RankBy } from '@/lib/stats';
import { useLibrary } from '@/store/library-store';
import { useStats } from '@/store/stats-store';

function RankBar({ ratio }: { ratio: number }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(4, ratio * 100)}%` }]} />
    </View>
  );
}

export default function StatsScreen() {
  const days = useStats((s) => s.days);
  const meta = useStats((s) => s.meta);
  const tracks = useLibrary((s) => s.tracks);

  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(() => new Date());
  const [by, setBy] = useState<RankBy>('time');

  const key = periodKey(anchor, period);
  const nextAnchor = shiftPeriod(anchor, period, 1);
  const canGoNext = periodKey(nextAnchor, period) <= periodKey(new Date(), period);

  const summary = useMemo(() => summarize(days, key), [days, key]);
  const topTracks = useMemo(() => rank(summary.tracks, by, 10), [summary, by]);
  const topArtists = useMemo(() => rank(summary.artists, by, 10), [summary, by]);
  const allTimeMs = useMemo(() => totalAllTime(days), [days]);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);

  const value = (r: { ms: number; plays: number }) => (by === 'time' ? r.ms : r.plays);
  const display = (r: { ms: number; plays: number }) =>
    by === 'time' ? formatListening(r.ms) : pluralize(r.plays, 'vez', 'vezes');

  const maxTrack = topTracks[0] ? value(topTracks[0]) : 1;
  const maxArtist = topArtists[0] ? value(topArtists[0]) : 1;

  const confirmReset = () =>
    Alert.alert('Apagar histórico', 'Isso zera todo o tempo ouvido e os rankings. As músicas da biblioteca não são afetadas.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: () => useStats.getState().reset() },
    ]);

  return (
    <Screen title="Estatísticas" subtitle={`Total já ouvido: ${formatListening(allTimeMs)}`}>
      <Segmented
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setAnchor(new Date());
        }}
        options={[
          { value: 'day', label: 'Dia' },
          { value: 'month', label: 'Mês' },
          { value: 'year', label: 'Ano' },
        ]}
      />

      <View style={styles.nav}>
        <Pressable onPress={() => setAnchor(shiftPeriod(anchor, period, -1))} hitSlop={12} style={styles.navButton}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.navLabel}>{periodLabel(anchor, period)}</Text>
        <Pressable
          onPress={() => canGoNext && setAnchor(nextAnchor)}
          disabled={!canGoNext}
          hitSlop={12}
          style={[styles.navButton, !canGoNext && { opacity: 0.25 }]}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroKicker}>TEMPO OUVIDO</Text>
        <Text style={styles.heroValue}>{formatListening(summary.totalMs)}</Text>
      </View>

      <View style={styles.cards}>
        <StatCard label="Reproduções" value={String(summary.plays)} />
        <StatCard label="Músicas" value={String(summary.tracks.filter((t) => t.ms > 0).length)} />
        <StatCard label="Artistas" value={String(summary.artists.filter((a) => a.ms > 0).length)} />
      </View>

      {summary.totalMs === 0 ? (
        <EmptyState icon="stats-chart-outline" title="Sem dados neste período" text="Ouça algumas músicas e os rankings aparecem aqui." />
      ) : (
        <>
          <View style={{ marginTop: spacing.lg }}>
            <Segmented
              value={by}
              onChange={setBy}
              options={[
                { value: 'time', label: 'Por tempo' },
                { value: 'plays', label: 'Por reproduções' },
              ]}
            />
          </View>

          <SectionHeader title="Músicas mais ouvidas" />
          {topTracks.map((r, i) => {
            const track = byId.get(r.key);
            const info = meta[r.key];
            const title = track?.title ?? info?.title ?? 'Faixa removida';
            const artist = track?.artist ?? info?.artist ?? '';
            return (
              <View key={r.key} style={styles.rankRow}>
                <Text style={styles.rankNumber}>{i + 1}</Text>
                <Cover uri={track?.coverUrl ?? info?.coverUrl} seed={title} size={46} radius={8} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text numberOfLines={1} style={styles.rankTitle}>{title}</Text>
                  <Text numberOfLines={1} style={styles.rankSub}>{artist}</Text>
                  <RankBar ratio={value(r) / maxTrack} />
                </View>
                <Text style={styles.rankValue}>{display(r)}</Text>
              </View>
            );
          })}

          <SectionHeader title="Artistas mais ouvidos" />
          {topArtists.map((r, i) => (
            <View key={r.key} style={styles.rankRow}>
              <Text style={styles.rankNumber}>{i + 1}</Text>
              <Cover seed={r.key} size={46} round />
              <View style={{ flex: 1, gap: 3 }}>
                <Text numberOfLines={1} style={styles.rankTitle}>{r.key}</Text>
                <RankBar ratio={value(r) / maxArtist} />
              </View>
              <Text style={styles.rankValue}>{display(r)}</Text>
            </View>
          ))}
        </>
      )}

      {allTimeMs > 0 ? (
        <Pressable onPress={confirmReset} style={styles.reset}>
          <Text style={styles.resetText}>Apagar histórico de escuta</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.md },
  navButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  navLabel: { color: colors.text, fontSize: 17, fontWeight: '800' },
  hero: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  heroKicker: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  heroValue: { color: colors.text, fontSize: 46, fontWeight: '800', letterSpacing: -1.5 },
  cards: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  rankNumber: { width: 20, textAlign: 'center', color: colors.muted, fontSize: 14, fontWeight: '800' },
  rankTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rankSub: { color: colors.muted, fontSize: 12.5 },
  rankValue: { color: colors.text, fontSize: 13, fontWeight: '700', minWidth: 58, textAlign: 'right' },
  barTrack: { height: 3, borderRadius: 2, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },
  reset: { alignSelf: 'center', marginTop: spacing.xl, padding: 10 },
  resetText: { color: colors.faint, fontSize: 13, fontWeight: '600' },
});
