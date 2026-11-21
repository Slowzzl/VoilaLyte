import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from '@/constants/theme';

/** Telas "internas" (sem barra de abas). */
export function hidesTabBar(pathname: string): boolean {
  return pathname.startsWith('/playlist/') || pathname.startsWith('/user/') || pathname.startsWith('/friends');
}

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

/**
 * Quanto o conteúdo precisa subir por causa do teclado.
 * Em Android com tela cheia (edge-to-edge) o sistema NÃO redimensiona a janela, então os campos ficavam escondidos.
 * Se o sistema já redimensionou (altura do container encolheu), devolve 0 para não somar duas vezes.
 * Passe `onLayout` para a View raiz (tela ou conteúdo do Modal).
 */
export function useKeyboardOffset(): { offset: number; keyboardHeight: number; onLayout: (e: LayoutChangeEvent) => void } {
  const [offset, setOffset] = useState(0);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const currentHeight = useRef(0);
  const maxHeight = useRef(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    currentHeight.current = h;
    maxHeight.current = Math.max(maxHeight.current, h);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (event) => {
      const kb = event.endCoordinates.height;
      setKeyboardHeight(kb);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const resizedBy = maxHeight.current - currentHeight.current;
        setOffset(resizedBy >= kb * 0.7 ? 0 : kb);
      }, 80);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      clearTimeout(timer);
      setOffset(0);
      setKeyboardHeight(0);
    });
    return () => {
      clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, []);

  return { offset, keyboardHeight, onLayout };
}

/** Espaço que o mini player e as abas ocupam embaixo da tela. */
export function useChrome(options: { tabBar: boolean; mini: boolean }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = options.tabBar ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom;
  const miniBottom = options.tabBar ? TAB_BAR_HEIGHT + insets.bottom : insets.bottom + 4;
  const contentBottom = tabBarHeight + (options.mini ? MINI_PLAYER_HEIGHT : 0);
  return { insets, tabBarHeight, miniBottom, contentBottom };
}
