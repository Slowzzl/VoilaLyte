# Spotylite — migração para biblioteca local

Este pacote contém a primeira etapa da migração do Spotylite para uma biblioteca musical própria.

## Arquivos incluídos

- `src/services/library-storage.ts`: armazenamento local, playlists e faixas únicas.
- `src/data/spotify-api.ts`: leitura das playlists e faixas da conta Spotify.
- `src/app/library.tsx`: tela Biblioteca, importação Spotify e criação de playlists locais.
- `src/app/playlist/[id].tsx`: tela de playlist usando referências aos registros da biblioteca.
- `src/app/search.tsx`: busca local por música, artista, álbum e playlist.
- `src/app/index.tsx`: início com resumo da biblioteca.
- `src/app/profile.tsx`: conexão Spotify simplificada.
- `src/app/_layout.tsx`: navegação sem MiniPlayer/NowPlaying/PlayerProvider.

## Instalação

1. Faça backup do projeto atual.
2. Copie a pasta `src` deste pacote para a raiz do Spotylite, mesclando/substituindo os arquivos correspondentes.
3. Mantenha `src/context/auth-context.tsx` e `src/app/callback.tsx` atuais: o OAuth ainda é necessário para ler playlists privadas da própria conta.
4. Mantenha `src/context/settings-context.tsx`, `src/constants/spoty-theme.ts` e `src/components/screen.tsx` atuais.
5. Execute:

```bash
npx tsc --noEmit
npx expo install --check
npx expo start -c
```

## Modelo de dados

Cada faixa é gravada uma vez em `tracks`. Cada playlist guarda apenas `trackIds`. Importar novamente atualiza as playlists Spotify já conhecidas e preserva playlists locais.

O armazenamento desta etapa usa AsyncStorage no dispositivo. Ainda não há upload para servidor, seleção de arquivos, player de arquivos locais ou sincronização entre aparelhos.

## Importação de áudio

A tela Importar aceita arquivos MP3 e arquivos ZIP contendo áudio. Os arquivos são copiados para o armazenamento local do app; os originais permanecem no dispositivo. Cada ZIP cria ou atualiza uma playlist com o nome do arquivo.

Faixas são identificadas por SHA-256 do conteúdo. Ao importar uma faixa já existente, o app reutiliza o arquivo e adiciona a mesma faixa à playlist, sem gravar uma cópia adicional. A importação usa o seletor de arquivos do dispositivo; não há importação por link nem fila de downloads.

## Observação sobre permissões

O fluxo OAuth atual deve conceder acesso de leitura às playlists. Se o `auth-context.tsx` tiver escopos antigos, eles podem ser reduzidos depois para permissões de leitura de playlists compatíveis com os endpoints utilizados. Não remova o callback OAuth enquanto a importação de conta for necessária.


Adicionar função de reorganização de queue e da playlist,, tambem adicionar musica a playulist.