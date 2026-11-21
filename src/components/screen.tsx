import React, { useCallback, useRef } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/constants/theme';
import { useChrome, useKeyboardOffset } from '@/lib/layout';
import { usePlayer } from '@/store/player-store';

type Props = ScrollViewProps & {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Telas internas (playlist, amigos, perfil de usuário) não têm barra de abas. */
  hideTabBar?: boolean;
  /** Conteúdo fixo na parte de baixo (ex.: barra de ações da seleção). */
  footer?: React.ReactNode;
  /** Espaço extra no fim da rolagem para o rodapé não cobrir o último item. */
  extraBottom?: number;
  children: React.ReactNode;
};

/** Container padrão: fundo escuro, título grande e espaço reservado para mini player + abas (+ teclado). */
export function Screen({ title, subtitle, right, children, hideTabBar = false, footer, extraBottom = 0, onScroll, ...rest }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const hasMini = usePlayer((s) => s.current !== null);
  const { contentBottom } = useChrome({ tabBar: !hideTabBar, mini: hasMini });
  const { offset, keyboardHeight, onLayout } = useKeyboardOffset();
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  // Teclado aberto: o mini player e as abas ficam escondidos, então o espaço vira altura do teclado.
  const bottom = (keyboardHeight > 0 ? offset + spacing.xl : contentBottom + spacing.lg) + extraBottom;

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  // Rola até o campo focado para ele não ficar atrás do teclado.
  React.useEffect(() => {
    if (keyboardHeight === 0) return;
    const timer = setTimeout(() => {
      const input = (TextInput as any).State?.currentlyFocusedInput?.();
      input?.measureInWindow?.((_x: number, y: number, _w: number, h: number) => {
        const visibleBottom = windowHeight - keyboardHeight - 16;
        const overflow = y + h - visibleBottom;
        if (overflow > 0) scrollRef.current?.scrollTo({ y: scrollY.current + overflow + 12, animated: true });
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [keyboardHeight, windowHeight]);

  return (
    <View style={styles.root} onLayout={onLayout}>
      <ScrollView
        {...rest}
        ref={scrollRef}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingHorizontal: spacing.md, paddingBottom: bottom }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {title ? (
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            {right}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 2 },
});
