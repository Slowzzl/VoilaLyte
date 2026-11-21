import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Cover } from '@/components/cover';
import { colors, radius, spacing } from '@/constants/theme';
import { formatClock } from '@/lib/format';
import { activePresence, type Presence } from '@/store/social-store';

/** Cartão no estilo "Ouvindo agora" do Discord, com capa e barra de progresso ao vivo. */
export function ActivityCard({ presence, compact = false }: { presence: Presence | null | undefined; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const live = activePresence(presence);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);

  if (!live) return null;
  const started = Date.parse(live.started_at!);
  const duration = live.duration_ms ?? 0;
  const elapsed = Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, now - started));
  const ratio = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return (
    <View style={[styles.card, compact && styles.compact]}>
      <Cover uri={live.cover_url} seed={live.title ?? '♪'} size={compact ? 46 : 64} radius={10} />
      <View style={styles.body}>
        <Text style={styles.kicker}>OUVINDO AGORA</Text>
        <Text numberOfLines={1} style={styles.title}>{live.title}</Text>
        <Text numberOfLines={1} style={styles.artist}>{live.artist}</Text>
        {duration > 0 && !compact ? (
          <View style={styles.progressRow}>
            <Text style={styles.time}>{formatClock(elapsed)}</Text>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
            </View>
            <Text style={styles.time}>{formatClock(duration)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  compact: { padding: 10, gap: 10, backgroundColor: colors.surfaceHigh, borderWidth: 0 },
  body: { flex: 1, minWidth: 0, gap: 1 },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 15, fontWeight: '800' },
  artist: { color: colors.muted, fontSize: 13 },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  track: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  time: { color: colors.faint, fontSize: 10.5, fontVariant: ['tabular-nums'] },
});
