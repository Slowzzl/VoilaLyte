import { Ionicons } from '@expo/vector-icons';
import React, { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { colors } from '@/constants/theme';

type Props = {
  children: ReactNode;
  index: number;
  count: number;
  onPreviewMove: (fromIndex: number, toIndex: number) => void;
  onDrop: (fromIndex: number, toIndex: number) => void;
};

/**
 * Reordenação em duas fases:
 * - durante o gesto, só a lista temporária da tela é reorganizada;
 * - no soltamento, onDrop persiste a ordem uma única vez.
 * O gesto só chama JS quando cruza o limite de outra linha, nunca a cada pixel.
 */
function DragReorderRowComponent({ children, index, count, onPreviewMove, onDrop }: Props) {
  const translateY = useRef(new Animated.Value(0)).current;
  const rowHeight = useRef(1);
  const startIndex = useRef(index);
  const currentIndex = useRef(index);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const started = useRef(false);
  indexRef.current = index;
  countRef.current = count;
  const lastIndexProp = useRef(index);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const callbacks = useRef({ onPreviewMove, onDrop });
  callbacks.current = { onPreviewMove, onDrop };

  // Quando a posição temporária muda, as outras linhas deslizam para a nova vaga.
  useEffect(() => {
    if (dragging.current || lastIndexProp.current === index) {
      lastIndexProp.current = index;
      currentIndex.current = index;
      return;
    }
    const previousIndex = lastIndexProp.current;
    lastIndexProp.current = index;
    currentIndex.current = index;
    translateY.setValue((previousIndex - index) * rowHeight.current);
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      damping: 24,
      stiffness: 260,
      mass: 0.7,
    }).start();
  }, [index, translateY]);

  const gesture = useMemo(() => Gesture.Pan()
    .activateAfterLongPress(160)
    .runOnJS(true)
    .onStart(() => {
      dragging.current = true;
      started.current = true;
      startIndex.current = indexRef.current;
      currentIndex.current = indexRef.current;
      setIsDragging(true);
    })
    .onUpdate((event) => {
      const height = Math.max(rowHeight.current, 1);
      const targetIndex = Math.max(0, Math.min(countRef.current - 1, startIndex.current + Math.round(event.translationY / height)));
      if (targetIndex !== currentIndex.current) {
        callbacks.current.onPreviewMove(currentIndex.current, targetIndex);
        currentIndex.current = targetIndex;
      }
      // Compensa o deslocamento de layout já aplicado pela ordem temporária.
      translateY.setValue(event.translationY - (targetIndex - startIndex.current) * height);
    })
    .onFinalize(() => {
      const from = startIndex.current;
      const to = currentIndex.current;
      dragging.current = false;
      setIsDragging(false);
      if (started.current) callbacks.current.onDrop(from, to);
      started.current = false;
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 24,
        stiffness: 260,
        mass: 0.7,
      }).start();
    }), [translateY]);

  const onLayout = (event: LayoutChangeEvent) => {
    rowHeight.current = Math.max(event.nativeEvent.layout.height, 1);
  };

  return (
    <Animated.View style={[styles.row, isDragging && styles.dragging, { transform: [{ translateY }] }]}>
      <View onLayout={onLayout} style={styles.content}>{children}</View>
      <GestureDetector gesture={gesture}>
        <View style={styles.handle} accessibilityLabel="Arrastar para reordenar">
          <Ionicons name="reorder-three" size={22} color={isDragging ? colors.accent : colors.muted} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

export const DragReorderRow = memo(DragReorderRowComponent);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dragging: { zIndex: 10, backgroundColor: colors.surface, borderRadius: 8, elevation: 5 },
  content: { flex: 1, minWidth: 0 },
  handle: { width: 40, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
});
