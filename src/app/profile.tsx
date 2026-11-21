import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Cover } from '@/components/cover';
import { Screen } from '@/components/screen';
import { TopList } from '@/components/top-list';
import { Button, SectionHeader, Segmented } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { formatListening } from '@/lib/format';
import { buildTop } from '@/lib/top';
import { useCoverStatus } from '@/services/cover-upload';
import { discordAvailable, discordService, useDiscord } from '@/services/discord';
import { backendConfigured } from '@/services/supabase';
import { useSocial } from '@/store/social-store';
import { useStats } from '@/store/stats-store';

function DiscordCard() {
  const status = useDiscord((s) => s.status);
  const error = useDiscord((s) => s.error);
  const cover = useCoverStatus();

  if (!discordAvailable) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Discord</Text>
        <Text style={styles.muted}>A integração com o Discord só existe no app Android.</Text>
      </View>
    );
  }

  const linked = status === 'ready' || status === 'connecting';
  const label =
    status === 'ready' ? 'Vinculado — mostrando sua música no Discord'
    : status === 'connecting' ? 'Conectando…'
    : status === 'error' ? `Erro: ${error ?? 'tente novamente'}`
    : 'Não vinculado';

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Ionicons name="logo-discord" size={22} color={status === 'ready' ? colors.accent : colors.muted} />
        <Text style={styles.cardTitle}>Discord</Text>
      </View>
      <Text style={[styles.muted, status === 'error' && { color: colors.danger }]}>{label}</Text>
      {status === 'ready' && cover.state === 'uploading' ? <Text style={styles.hint}>Enviando a capa da música…</Text> : null}
      {status === 'ready' && cover.state === 'error' ? (
        <Text style={[styles.hint, { color: colors.danger }]}>Capa não enviada: {cover.message}</Text>
      ) : null}
      <Text style={styles.hint}>
        Vincule uma única vez. Depois disso o app reconecta sozinho, sem abrir a autorização toda vez.
      </Text>
      {linked ? (
        <Button
          label="Desvincular Discord"
          variant="ghost"
          icon="unlink-outline"
          onPress={() => discordService.disconnect().catch(() => undefined)}
        />
      ) : (
        <Button
          label={status === 'error' ? 'Tentar novamente' : 'Vincular ao Discord'}
          icon="link-outline"
          onPress={() => discordService.connect().catch((e) => Alert.alert('Discord', String(e?.message ?? e)))}
        />
      )}
    </View>
  );
}

function AuthCard() {
  const busy = useSocial((s) => s.busy);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async () => {
    try {
      const { signIn, signUp } = useSocial.getState();
      if (mode === 'login') await signIn(username, password);
      else await signUp(username, password);
      setPassword('');
    } catch (error) {
      Alert.alert(mode === 'login' ? 'Entrar' : 'Criar conta', error instanceof Error ? error.message : 'Não foi possível continuar.');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Sua conta</Text>
      <Text style={styles.hint}>Crie um perfil para ter amigos e mostrar o que você está ouvindo.</Text>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'login', label: 'Entrar' },
          { value: 'signup', label: 'Criar conta' },
        ]}
      />
      <TextInput
        value={username}
        onChangeText={(t) => setUsername(t.toLowerCase())}
        placeholder="nome de usuário"
        placeholderTextColor={colors.faint}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        style={styles.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="senha"
        placeholderTextColor={colors.faint}
        secureTextEntry
        autoCapitalize="none"
        style={styles.input}
        onSubmitEditing={submit}
      />
      {mode === 'signup' ? <Text style={styles.hint}>3 a 20 caracteres: letras minúsculas, números e _. Anote a senha: não há recuperação por e-mail.</Text> : null}
      <Button label={mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} />
    </View>
  );
}

export default function ProfileScreen() {
  const me = useSocial((s) => s.me);
  const ready = useSocial((s) => s.ready);
  const incoming = useSocial((s) => s.incoming.length);
  const friendCount = useSocial((s) => s.friends.length);
  const days = useStats((s) => s.days);
  const meta = useStats((s) => s.meta);
  const [by, setBy] = useState<'time' | 'plays'>('time');

  const top = useMemo(() => buildTop(days, meta, by, 10), [days, meta, by]);
  const totalMs = useMemo(() => Object.values(days).reduce((sum, d) => sum + d.ms, 0), [days]);

  const toggleShare = async (value: boolean) => {
    try {
      await useSocial.getState().setShareActivity(value);
    } catch (error) {
      Alert.alert('Atividade', error instanceof Error ? error.message : 'Não foi possível salvar.');
    }
  };

  return (
    <Screen title="Perfil" subtitle={me ? `@${me.username}` : 'Seu espaço no Spotylite'}>
      {me ? (
        <View style={styles.identity}>
          <Cover seed={me.username} size={64} round />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>@{me.username}</Text>
            <Text style={styles.muted}>{formatListening(totalMs)} ouvidos no total</Text>
          </View>
        </View>
      ) : null}

      <DiscordCard />

      {!backendConfigured ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Amigos e atividade</Text>
          <Text style={styles.muted}>
            O servidor ainda não foi configurado. Siga o SETUP.md (Supabase) e defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY.
          </Text>
        </View>
      ) : !ready ? null : !me ? (
        <AuthCard />
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Mostrar minha atividade</Text>
                <Text style={styles.hint}>Seus amigos veem o que você está ouvindo agora. Desligue para ficar invisível.</Text>
              </View>
              <Switch
                value={me.share_activity}
                onValueChange={toggleShare}
                trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
                thumbColor={colors.text}
              />
            </View>
          </View>

          <Pressable onPress={() => router.push('/friends')} style={styles.friendsRow}>
            <Ionicons name="people-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Amigos</Text>
              <Text style={styles.muted}>
                {friendCount} {friendCount === 1 ? 'amigo' : 'amigos'}
                {incoming > 0 ? ` · ${incoming} ${incoming === 1 ? 'pedido novo' : 'pedidos novos'}` : ''}
              </Text>
            </View>
            {incoming > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{incoming}</Text></View> : null}
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </>
      )}

      <SectionHeader title="Mais tocados" />
      <Segmented
        value={by}
        onChange={setBy}
        options={[
          { value: 'time', label: 'Por tempo' },
          { value: 'plays', label: 'Por reproduções' },
        ]}
      />
      <Text style={styles.listTitle}>Músicas</Text>
      <TopList entries={top.tracks} empty="Ouça algumas músicas e o ranking aparece aqui." />
      <Text style={styles.listTitle}>Artistas</Text>
      <TopList entries={top.artists} empty="Nenhum artista ainda." />

      {me ? (
        <Pressable
          onPress={() =>
            Alert.alert('Sair da conta', 'Você deixa de aparecer para seus amigos neste aparelho.', [
              { text: 'Cancelar', style: 'cancel' },
              { text: 'Sair', style: 'destructive', onPress: () => void useSocial.getState().signOut() },
            ])
          }
          style={styles.signOut}
        >
          <Text style={styles.signOutText}>Sair da conta</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: spacing.md },
  name: { color: colors.text, fontSize: 20, fontWeight: '800' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: 10, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13.5 },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 17 },
  input: { color: colors.text, backgroundColor: colors.surfaceHigh, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 48, fontSize: 15 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  friendsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: colors.onAccent, fontSize: 12, fontWeight: '800' },
  listTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.md, marginBottom: 2 },
  signOut: { alignSelf: 'center', marginTop: spacing.xl, padding: 10 },
  signOutText: { color: colors.faint, fontSize: 13, fontWeight: '600' },
});
