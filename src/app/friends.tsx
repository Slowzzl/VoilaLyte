import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ActivityCard } from '@/components/activity-card';
import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { EmptyState, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { activePresence, useSocial, type SearchHit } from '@/store/social-store';

function Avatar({ name }: { name: string }) {
  return <Cover seed={name} size={44} round />;
}

function SmallButton({ label, onPress, variant = 'primary', disabled }: { label: string; onPress: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.smallButton, variant === 'ghost' && styles.smallGhost, disabled && { opacity: 0.55 }]}
    >
      <Text style={[styles.smallText, variant === 'ghost' && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export default function FriendsScreen() {
  const me = useSocial((s) => s.me);
  const friends = useSocial((s) => s.friends);
  const incoming = useSocial((s) => s.incoming);
  const outgoing = useSocial((s) => s.outgoing);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Atualiza amigos e o que estão ouvindo enquanto a tela está aberta.
  useFocusEffect(
    useCallback(() => {
      void useSocial.getState().refreshFriends();
      const timer = setInterval(() => void useSocial.getState().refreshFriends(), 15_000);
      return () => clearInterval(timer);
    }, []),
  );

  // Busca geral por nome de usuário (com atraso para não consultar a cada letra).
  useEffect(() => {
    const term = query.trim();
    if (term.replace(/[^a-zA-Z0-9_]/g, '').length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await useSocial.getState().search(term);
        if (!cancelled) setHits(result);
      } catch (error) {
        if (!cancelled) Alert.alert('Busca', error instanceof Error ? error.message : 'Não foi possível buscar.');
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Mantém o estado dos botões (Adicionar/Pendente/Amigos) coerente depois de uma ação.
  useEffect(() => {
    if (!hits) return;
    const term = query.trim();
    useSocial.getState().search(term).then(setHits).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends.length, incoming.length, outgoing.length]);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      Alert.alert('Amigos', error instanceof Error ? error.message : 'Não foi possível concluir.');
    }
  };

  const open = (id: string) => router.push({ pathname: '/user/[id]', params: { id } });

  return (
    <Screen
      hideTabBar
      title="Amigos"
      right={
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.close} accessibilityLabel="Voltar">
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
      }
    >
      {!me ? (
        <EmptyState icon="person-circle-outline" title="Entre na sua conta" text="Crie um perfil na aba Perfil para adicionar amigos e ver o que eles ouvem." />
      ) : (
        <>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar pessoas pelo nome de usuário"
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching ? <ActivityIndicator size="small" color={colors.muted} /> : null}
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {hits ? (
            <>
              <SectionHeader title="Resultados" />
              {hits.length === 0 && !searching ? <Text style={styles.empty}>Ninguém encontrado com “{query.trim()}”.</Text> : null}
              {hits.map((hit) => (
                <Pressable key={hit.id} onPress={() => open(hit.id)} style={styles.row}>
                  <Avatar name={hit.username} />
                  <Text numberOfLines={1} style={styles.username}>@{hit.username}</Text>
                  {hit.relation === 'friend' ? (
                    <Text style={styles.tag}>Amigos</Text>
                  ) : hit.relation === 'sent' ? (
                    <SmallButton label="Cancelar pedido" variant="ghost" onPress={() => run(() => useSocial.getState().remove(hit.friendshipId!))} />
                  ) : hit.relation === 'received' ? (
                    <SmallButton label="Aceitar" onPress={() => run(() => useSocial.getState().accept(hit.friendshipId!))} />
                  ) : (
                    <SmallButton label="Adicionar" onPress={() => run(() => useSocial.getState().sendRequest(hit.id))} />
                  )}
                </Pressable>
              ))}
            </>
          ) : null}

          {incoming.length > 0 ? (
            <>
              <SectionHeader title={`Pedidos recebidos (${incoming.length})`} />
              {incoming.map((request) => (
                <View key={request.friendshipId} style={styles.row}>
                  <Pressable onPress={() => open(request.profile.id)} style={styles.rowMain}>
                    <Avatar name={request.profile.username} />
                    <Text numberOfLines={1} style={styles.username}>@{request.profile.username}</Text>
                  </Pressable>
                  <SmallButton label="Aceitar" onPress={() => run(() => useSocial.getState().accept(request.friendshipId))} />
                  <SmallButton label="Recusar" variant="ghost" onPress={() => run(() => useSocial.getState().remove(request.friendshipId))} />
                </View>
              ))}
            </>
          ) : null}

          <SectionHeader title={`Seus amigos (${friends.length})`} />
          {friends.length === 0 ? (
            <Text style={styles.empty}>Busque um nome de usuário acima para enviar o primeiro pedido.</Text>
          ) : (
            friends.map((friend) => {
              const live = activePresence(friend.presence);
              return (
                <Pressable key={friend.friendshipId} onPress={() => open(friend.profile.id)} style={styles.friendBlock}>
                  <View style={styles.rowInner}>
                    <Avatar name={friend.profile.username} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.username}>@{friend.profile.username}</Text>
                      <Text style={styles.status}>
                        {live ? 'Ouvindo agora' : friend.profile.share_activity ? 'Offline' : 'Atividade oculta'}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </View>
                  {live ? <ActivityCard presence={friend.presence} compact /> : null}
                </Pressable>
              );
            })
          )}

          {outgoing.length > 0 ? (
            <>
              <SectionHeader title="Pedidos enviados" />
              {outgoing.map((request) => (
                <View key={request.friendshipId} style={styles.row}>
                  <Pressable onPress={() => open(request.profile.id)} style={styles.rowMain}>
                    <Avatar name={request.profile.username} />
                    <Text numberOfLines={1} style={styles.username}>@{request.profile.username}</Text>
                  </Pressable>
                  <SmallButton label="Cancelar" variant="ghost" onPress={() => run(() => useSocial.getState().remove(request.friendshipId))} />
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 48 },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  friendBlock: { gap: 8, paddingVertical: 8 },
  username: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  status: { color: colors.muted, fontSize: 12.5, marginTop: 1 },
  tag: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  empty: { color: colors.faint, fontSize: 13, paddingVertical: spacing.sm },
  smallButton: { backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  smallGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border },
  smallText: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
});
