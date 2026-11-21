import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { TopList } from '@/components/top-list';
import { Button, EmptyState, SectionHeader } from '@/components/ui';
import { colors, spacing } from '@/constants/theme';
import { formatListening } from '@/lib/format';
import { useSocial, type Presence, type PublicProfile } from '@/store/social-store';

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useSocial((s) => s.me);
  const friends = useSocial((s) => s.friends);
  const incoming = useSocial((s) => s.incoming);
  const outgoing = useSocial((s) => s.outgoing);

  const [data, setData] = useState<{ profile: PublicProfile; presence: Presence | null } | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setData(await useSocial.getState().loadProfile(id));
    } catch {
      setData((previous) => previous ?? null);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), 15_000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const friend = friends.find((f) => f.profile.id === id);
  const received = incoming.find((r) => r.profile.id === id);
  const sent = outgoing.find((r) => r.profile.id === id);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      Alert.alert('Amigos', error instanceof Error ? error.message : 'Não foi possível concluir.');
    }
  };

  const back = (
    <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
      <Ionicons name="chevron-back" size={24} color={colors.text} />
    </Pressable>
  );

  if (data === undefined) {
    return (
      <Screen hideTabBar>
        {back}
        <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }
  if (data === null) {
    return (
      <Screen hideTabBar>
        {back}
        <EmptyState icon="alert-circle-outline" title="Perfil não encontrado" text="Ele pode ter sido removido ou você está sem conexão." />
      </Screen>
    );
  }

  const { profile, presence } = data;
  const isMe = me?.id === profile.id;

  return (
    <Screen hideTabBar>
      {back}
      <View style={styles.header}>
        <Cover seed={profile.username} size={88} round />
        <Text style={styles.name}>@{profile.username}</Text>
        <Text style={styles.sub}>{formatListening(profile.total_ms)} ouvidos no total</Text>
      </View>

      {!isMe ? (
        friend ? (
          <Button
            label="Desfazer amizade"
            variant="ghost"
            icon="person-remove-outline"
            onPress={() =>
              Alert.alert('Desfazer amizade', `Remover @${profile.username} dos seus amigos?`, [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Remover', style: 'destructive', onPress: () => void run(() => useSocial.getState().remove(friend.friendshipId)) },
              ])
            }
          />
        ) : received ? (
          <Button label="Aceitar pedido" icon="checkmark" onPress={() => run(() => useSocial.getState().accept(received.friendshipId))} />
        ) : sent ? (
          <Button label="Cancelar pedido" variant="ghost" onPress={() => run(() => useSocial.getState().remove(sent.friendshipId))} />
        ) : (
          <Button label="Adicionar amigo" icon="person-add-outline" onPress={() => run(() => useSocial.getState().sendRequest(profile.id))} />
        )
      ) : null}

      {presence ? (
        <>
          <SectionHeader title="Atividade" />
          <ActivityCard presence={presence} />
        </>
      ) : null}

      <SectionHeader title="Músicas mais tocadas" />
      <TopList entries={profile.top_tracks ?? []} empty="Ainda sem dados." />
      <SectionHeader title="Artistas mais tocados" />
      <TopList entries={profile.top_artists ?? []} empty="Ainda sem dados." />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  header: { alignItems: 'center', gap: 6, marginBottom: spacing.md },
  name: { color: colors.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 6 },
  sub: { color: colors.muted, fontSize: 14 },
});
