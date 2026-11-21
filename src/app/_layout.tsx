import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AddToPlaylistsSheet } from '@/components/add-to-playlists';
import { MiniPlayer } from '@/components/mini-player';
import { NowPlaying } from '@/components/now-playing';
import { QueueSheet } from '@/components/queue-sheet';
import { TabBar } from '@/components/tab-bar';
import { TrackMenu } from '@/components/track-menu';
import { colors } from '@/constants/theme';
import { initActivitySync } from '@/services/activity-sync';
import { initDiscordStatus } from '@/services/discord';
import { subscribeToDownloads } from '@/services/downloader';
import { initPlayer } from '@/store/player-store';
import { useSocial } from '@/store/social-store';

export default function RootLayout() {
  useEffect(() => {
    return initPlayer();
  }, []);

  useEffect(() => {
    void useSocial.getState().init();
    const stopDiscordStatus = initDiscordStatus();
    const stopActivity = initActivitySync();
    const stopDownloads = subscribeToDownloads(); // vive enquanto o app vive, não enquanto a tela "Importar" está aberta
    return () => {
      stopDownloads();
      stopDiscordStatus();
      stopActivity();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
        <TabBar />
        <MiniPlayer />
        <NowPlaying />
        <QueueSheet />
        <TrackMenu />
        <AddToPlaylistsSheet />
      </View>
    </GestureHandlerRootView>
  );
}
