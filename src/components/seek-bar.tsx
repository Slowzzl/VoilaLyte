import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';
import { formatClock } from '@/lib/format';

type Props = {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
};

/** Barra de progresso arrastável, sem dependências extras. */
export function SeekBar({ positionMs, durationMs, onSeek }: Props) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);

  const ratio = drag ?? (durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0);
  const toRatio = (x: number) => (width > 0 ? Math.min(1, Math.max(0, x / width)) : 0);

  return (
    <View>
      <View
        style={styles.hit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDrag(toRatio(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDrag(toRatio(e.nativeEvent.locationX))}
        onResponderRelease={(e) => {
          const r = toRatio(e.nativeEvent.locationX);
          setDrag(null);
          if (durationMs > 0) onSeek(r * durationMs);
        }}
        onResponderTerminate={() => setDrag(null)}
      >
        {/* pointerEvents none: o locationX precisa ser relativo à área de toque, não aos filhos */}
        <View pointerEvents="none" style={styles.track}>
          <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.knob, { left: `${ratio * 100}%` }, drag !== null && styles.knobActive]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatClock(drag !== null ? drag * durationMs : positionMs)}</Text>
        <Text style={styles.time}>{formatClock(durationMs)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { height: 28, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, backgroundColor: colors.text },
  knobActive: { width: 16, height: 16, borderRadius: 8, marginLeft: -8 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
});
