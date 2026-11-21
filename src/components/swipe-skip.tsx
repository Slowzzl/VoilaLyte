import React, { useMemo, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { usePlayer } from '@/store/player-store';

const THRESHOLD = 70;
const VELOCITY = 650;

/**
 * Arrastar para a ESQUERDA = próxima música; para a DIREITA = anterior.
 * Usado no mini player e na capa do player aberto.
 */
export function SwipeSkip({ children, style, maxShift = 90 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; maxShift?: number }) {
  const x = useRef(new Animated.Value(0)).current;

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-12, 12])
        .failOffsetY([-18, 18])
        .onUpdate((event) => {
          x.setValue(Math.max(-maxShift, Math.min(maxShift, event.translationX)));
        })
        .onEnd((event) => {
          const left = event.translationX < -THRESHOLD || event.velocityX < -VELOCITY;
          const right = event.translationX > THRESHOLD || event.velocityX > VELOCITY;
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start();
          const { next, prev } = usePlayer.getState();
          if (left) next();
          else if (right) prev();
        })
        .onFinalize(() => {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 8 }).start();
        }),
    [x, maxShift],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[style, { transform: [{ translateX: x }] }]}>{children}</Animated.View>
    </GestureDetector>
  );
}
