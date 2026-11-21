import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

/** Modo de seleção múltipla. No Android, o botão voltar sai do modo antes de sair da tela. */
export function useSelection() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const start = useCallback(() => setActive(true), []);
  const exit = useCallback(() => {
    setActive(false);
    setSelected((previous) => (previous.size === 0 ? previous : new Set()));
  }, []);
  const toggle = useCallback((id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const selectAll = useCallback((ids: string[]) => setSelected(new Set(ids)), []);
  const clear = useCallback(() => setSelected(new Set()), []);

  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      exit();
      return true;
    });
    return () => subscription.remove();
  }, [active, exit]);

  return { active, selected, start, exit, toggle, selectAll, clear };
}

/**
 * Renderização incremental para listas grandes dentro de um ScrollView: começa com poucas linhas e libera mais
 * conforme o usuário se aproxima do fim. Evita montar centenas de linhas (com gestos e animações) de uma vez.
 */
export function useIncrementalLimit(total: number, step = 60) {
  const [limit, setLimit] = useState(step);
  const totalRef = useRef(total);
  totalRef.current = total;

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height < contentSize.height - 1200) return;
    setLimit((current) => (current < totalRef.current ? Math.min(current + step, totalRef.current) : current));
  }, [step]);

  const reset = useCallback(() => setLimit(step), [step]);

  return { limit, onScroll, reset };
}
