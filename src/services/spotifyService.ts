// services/spotifyService.ts

export interface SpotDLResponse {
  success: boolean;
  data?: any; // A estrutura exata depende da API específica do Otify
  error?: string;
}

/**
 * Função genérica para baixar música via API do Spotify
 * @param trackUrl URL da faixa/artista/álbum do Spotify
 * @returns Promise com os dados do download
 */
export const downloadFromSpotyLite = async (trackUrl: string): Promise<SpotDLResponse> => {
  try {
    // Substitua pela URL real da API do Otify
    const apiUrl = 'https://otify-api.vercel.app/api/download'; 
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Se a API exigir chave, adicione aqui:
        // 'Authorization': 'Bearer SUA_CHAVE_AQUI'
      },
      body: JSON.stringify({ url: trackUrl }),
    });

    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      data: data,
    };
  } catch (error) {
    console.error('Falha no download:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido',
    };
  }
};