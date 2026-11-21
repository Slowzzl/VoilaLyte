import { Alert } from 'react-native';
import { create } from 'zustand';

import { pickAndImport, type ImportResult } from '@/services/import-files';

/**
 * Estado da importação FORA da tela. Antes, o progresso, o resultado e os erros viviam em useState da tela
 * "Importar": ao navegar para outra página o componente era desmontado e o usuário perdia o andamento e o aviso
 * de conclusão. Agora a importação roda neste store e a tela só mostra o estado (ao voltar, ela continua de onde está).
 */
type ImportState = {
  running: boolean;
  startedAt: number | null;
  last: ImportResult | null;
  start: () => Promise<void>;
};

export const useImport = create<ImportState>()((set, get) => ({
  running: false,
  startedAt: null,
  last: null,

  start: async () => {
    if (get().running) return;
    set({ running: true });
    try {
      const result = await pickAndImport(() => set({ startedAt: Date.now() }));
      if (!result) return; // seletor cancelado
      set({ last: result });

      const count = result.imported.length;
      const summary =
        count > 0
          ? `${count} ${count === 1 ? 'música importada' : 'músicas importadas'}.`
          : result.skipped > 0
            ? 'Esses arquivos já estavam na biblioteca.'
            : 'Nada foi importado.';
      const problems = result.errors.length > 0 ? `\n\nFalharam:\n${result.errors.slice(0, 5).join('\n')}` : '';
      Alert.alert(result.errors.length > 0 ? 'Importação com falhas' : 'Importação concluída', summary + problems);
    } catch (error) {
      Alert.alert('Falha ao importar', error instanceof Error ? error.message : 'Erro desconhecido.');
    } finally {
      set({ running: false, startedAt: null });
    }
  },
}));
