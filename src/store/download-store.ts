import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createDeferredStorage } from '@/lib/deferred-storage';

export type DownloadStatus = 'queued' | 'downloading' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type DownloadTask = {
  id: string;
  url: string;
  title: string;
  status: DownloadStatus;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  trackId: string | null;
  playlistId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type NewDownloadTask = Pick<DownloadTask, 'id' | 'url' | 'title' | 'playlistId'>;
export type TaskPatch = Partial<Omit<DownloadTask, 'id'>>;

const TERMINAL: ReadonlySet<DownloadStatus> = new Set(['completed', 'failed', 'cancelled']);
export const isTerminalStatus = (status: DownloadStatus): boolean => TERMINAL.has(status);

/** Quantas tarefas já terminadas continuam salvas no disco (as ativas sempre são salvas). */
const MAX_PERSISTED_FINISHED = 100;

type DownloadState = {
  tasks: DownloadTask[];
  /** Adiciona várias tarefas de uma vez (1 atualização, 1ª da lista fica no topo). */
  addTasks: (inputs: NewDownloadTask[]) => void;
  addTask: (input: NewDownloadTask) => void;
  /** Aplica vários patches em uma única passada (1 atualização para N tarefas). */
  patchTasks: (patches: Record<string, TaskPatch>) => void;
  updateTask: (id: string, patch: TaskPatch) => void;
  /** Volta tarefas terminadas (falhas/canceladas) para a fila. */
  requeueTasks: (ids: string[]) => void;
  removeTask: (id: string) => void;
  clearFinished: () => void;
};

function makeTask(input: NewDownloadTask, now: number): DownloadTask {
  return {
    ...input,
    status: 'queued',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    trackId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export const useDownloads = create<DownloadState>()(
  persist(
    (set) => ({
      tasks: [],

      addTasks: (inputs) => {
        if (inputs.length === 0) return;
        const now = Date.now();
        const created = inputs.map((input) => makeTask(input, now));
        set((state) => ({ tasks: [...created, ...state.tasks] }));
      },

      addTask: (input) => {
        const created = makeTask(input, Date.now());
        set((state) => ({ tasks: [created, ...state.tasks] }));
      },

      patchTasks: (patches) => {
        if (Object.keys(patches).length === 0) return;
        const now = Date.now();
        set((state) => {
          let changed = false;
          const tasks = state.tasks.map((task) => {
            const patch = patches[task.id];
            if (!patch) return task;
            // Evento atrasado do módulo nativo não pode "ressuscitar" uma tarefa já cancelada/falha/concluída.
            if (isTerminalStatus(task.status) && patch.status && !isTerminalStatus(patch.status)) return task;
            changed = true;
            return { ...task, ...patch, updatedAt: now };
          });
          return changed ? { tasks } : state;
        });
      },

      updateTask: (id, patch) => useDownloads.getState().patchTasks({ [id]: patch }),

      requeueTasks: (ids) => {
        if (ids.length === 0) return;
        const wanted = new Set(ids);
        const now = Date.now();
        set((state) => ({
          tasks: state.tasks.map((task) => wanted.has(task.id)
            ? { ...task, status: 'queued', progress: 0, downloadedBytes: 0, totalBytes: null, error: null, updatedAt: now }
            : task),
        }));
      },

      removeTask: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),

      clearFinished: () => set((state) => ({
        tasks: state.tasks.filter((task) => !isTerminalStatus(task.status)),
      })),
    }),
    {
      name: '@spotylite/downloads/v1',
      storage: createDeferredStorage<{ tasks: DownloadTask[] }>(1500),
      partialize: (state) => {
        let finished = 0;
        // Lista ordenada do mais novo para o mais antigo: mantém todas as ativas e só as últimas terminadas.
        const tasks = state.tasks.filter((task) => !isTerminalStatus(task.status) || ++finished <= MAX_PERSISTED_FINISHED);
        return { tasks };
      },
    },
  ),
);
