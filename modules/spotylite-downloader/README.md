# Spotylite Downloader — módulo Expo local para Android

Este diretório precisa conter `package.json` e `expo-module.config.json` lado a lado. O Expo Autolinking usa esses arquivos para descobrir o módulo local.

## Instalação / atualização

Na raiz do Spotylite:

```bash
npx expo-modules-autolinking search
npx expo-modules-autolinking resolve --platform android
```

Confirme que `spotylite-downloader` e `com.spotylite.downloader.SpotyliteDownloaderModule` aparecem nos resultados. Depois gere novamente o projeto nativo e compile:

```bash
npx expo prebuild --platform android
npx expo run:android
```

Se o diretório `android/` tiver customizações manuais, faça backup primeiro. Não use `--clean` sem ter certeza de que pode regenerar todo o projeto.

O módulo exige um development build; não funciona no Expo Go. Alterações em Kotlin/Gradle exigem recompilar e reinstalar o aplicativo nativo — recarregar o Metro não basta.

## Diagnóstico

Se o módulo continuar ausente:

```bash
npx expo-modules-autolinking search | grep -A8 -B2 spotylite-downloader
npx expo-modules-autolinking resolve --platform android | grep -A8 -B2 SpotyliteDownloader
```

Se não aparecer em `search`, confira se `modules/spotylite-downloader/package.json` e `modules/spotylite-downloader/expo-module.config.json` estão no local correto. Se aparecer em `search` mas não em `resolve`, confira a chave `android.modules` no arquivo de configuração.

Downloads são destinados somente a conteúdo que o usuário tenha autorização para baixar. O módulo não implementa DRM, paywalls ou contorno de controles de acesso.
