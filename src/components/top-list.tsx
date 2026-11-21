import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing } from '@/constants/theme';
import { formatListening, pluralize } from '@/lib/format';
import type { TopEntry } from '@/lib/top';

/** Ranking só com texto (sem capas): posição, nome, artista e tempo ouvido. */
export function TopList({ entries, empty }: { entries: TopEntry[]; empty: string }) {
  if (entries.length === 0) return <Text style={styles.empty}>{empty}</Text>;
  return (
    <View>
      {entries.map((entry, i) => (
        <View key={`${entry.name}-${i}`} style={styles.row}>
          <Text style={styles.rank}>{i + 1}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.name}>{entry.name}</Text>
            {entry.sub ? <Text numberOfLines={1} style={styles.sub}>{entry.sub}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.value}>{formatListening(entry.ms)}</Text>
            <Text style={styles.sub}>{pluralize(entry.plays, 'vez', 'vezes')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  rank: { width: 22, textAlign: 'center', color: colors.muted, fontSize: 14, fontWeight: '800' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  sub: { color: colors.muted, fontSize: 12 },
  value: { color: colors.text, fontSize: 13, fontWeight: '700' },
  empty: { color: colors.faint, fontSize: 13, paddingVertical: spacing.sm },
});
