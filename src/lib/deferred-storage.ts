import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { PersistStorage, StorageValue } from 'zustand/middleware';

/**
 * Armazenamento "adiado" para o `persist` do Zustand.
 *
 * Problema anterior: cada `set()` de uma store persistida fazia JSON.stringify do estado INTEIRO e um
 * AsyncStorage.setItem. Numa playlist grande (centenas de faixas) cada evento de progresso/conclusão de download
 * regravava a biblioteca e a fila inteiras — dezenas de vezes por segundo — travando a thread JS.
 *
 * Aqui guardamos só o último estado em memória (os estados do Zustand são imutáveis, então é seguro) e
 * serializamos/gravamos uma única vez após `delayMs` sem novas mudanças (com limite máximo de espera).
 * Ao ir para segundo plano o app grava na hora, para não perder dados se o sistema encerrar o processo.
 */

type Entry = { value: StorageValue<any>; timer: ReturnType<typeof setTimeout>; firstAt: number };

const pending = new Map<string, Entry>();
let writeChain: Promise<void> = Promise.resolve();

function commit(name: string): void {
  const entry = pending.get(name);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(name);
  writeChain = writeChain
    .then(() => AsyncStorage.setItem(name, JSON.stringify(entry.value)))
    .catch((error: unknown) => console.warn(`Não foi possível salvar "${name}".`, error));
}

/** Grava imediatamente tudo o que ainda está esperando. */
export function flushPersistence(): Promise<void> {
  for (const name of [...pending.keys()]) commit(name);
  return writeChain;
}

let listening = false;
function ensureLifecycleFlush(): void {
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') void flushPersistence();
  });
}

export function createDeferredStorage<S>(delayMs = 1000, maxWaitMs = 5000): PersistStorage<S> {
  ensureLifecycleFlush();
  return {
    getItem: async (name) => {
      const waiting = pending.get(name);
      if (waiting) return waiting.value as StorageValue<S>;
      await writeChain;
      const raw = await AsyncStorage.getItem(name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      const previous = pending.get(name);
      if (previous) clearTimeout(previous.timer);
      const firstAt = previous?.firstAt ?? Date.now();
      // Não adia para sempre se o estado muda sem parar (ex.: download longo): grava no máximo a cada maxWaitMs.
      const wait = Math.max(0, Math.min(delayMs, firstAt + maxWaitMs - Date.now()));
      pending.set(name, { value, firstAt, timer: setTimeout(() => commit(name), wait) });
    },
    removeItem: async (name) => {
      const waiting = pending.get(name);
      if (waiting) clearTimeout(waiting.timer);
      pending.delete(name);
      await writeChain;
      await AsyncStorage.removeItem(name);
    },
  };
}
