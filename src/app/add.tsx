import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button, SectionHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/constants/theme';
import { cancelAllDownloads, cancelDownload, enqueueAuthorizedDownload, enqueueYoutubePlaylist, isYoutubePlaylistUrl, retryDownloads } from '@/services/downloader';
import { isTerminalStatus, useDownloads, type DownloadTask } from '@/store/download-store';
import { useImport } from '@/store/import-store';

const INFO = [
	{ icon: 'musical-notes-outline', text: 'Arquivos MP3 são copiados para a pasta local da biblioteca.' },
	{ icon: 'archive-outline', text: 'Cada ZIP cria uma playlist; capas cover.jpg, folder.jpg e imagens ao lado das faixas são associadas automaticamente.' },
	{ icon: 'copy-outline', text: 'Arquivos repetidos são armazenados uma vez e podem aparecer em várias playlists.' },
] as const;

function formatElapsed(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function statusLabel(status: string): string {
	switch (status) {
		case 'queued': return 'Na fila';
		case 'downloading': return 'Baixando';
		case 'processing': return 'Processando';
		case 'completed': return 'Concluído';
		case 'failed': return 'Falhou';
		case 'cancelled': return 'Cancelado';
		default: return status;
	}
}

/** Quantas linhas da fila aparecem de uma vez (playlists grandes têm centenas de tarefas). */
const VISIBLE_TASKS = 12;
const STATUS_PRIORITY: Record<string, number> = { downloading: 0, processing: 0, failed: 1, queued: 2, completed: 3, cancelled: 4 };

const DownloadRow = memo(function DownloadRow({ task }: { task: DownloadTask }) {
	const active = !isTerminalStatus(task.status);
	return (
		<View style={styles.downloadRow}>
			<View style={styles.downloadInfo}>
				<Text style={styles.downloadTitle} numberOfLines={1}>{task.title}</Text>
				<Text style={styles.downloadMeta}>{statusLabel(task.status)}{task.status === 'downloading' ? ` · ${Math.round(task.progress * 100)}%` : ''}</Text>
				{task.error ? <Text style={styles.downloadError} numberOfLines={2}>{task.error}</Text> : null}
			</View>
			{active ? (
				<Button label="Cancelar" variant="ghost" onPress={() => cancelDownload(task.id).catch((error) => Alert.alert('Erro', error instanceof Error ? error.message : 'Não foi possível cancelar.'))} />
			) : task.status !== 'completed' ? (
				<Button label="Tentar de novo" variant="ghost" onPress={() => retryDownloads([task.id])} />
			) : null}
		</View>
	);
});

export default function ImportScreen() {
	const busy = useImport((state) => state.running);
	const last = useImport((state) => state.last);
	const importStartedAt = useImport((state) => state.startedAt);
	const [downloadUrl, setDownloadUrl] = useState('');
	const [downloadBusy, setDownloadBusy] = useState(false);
	const downloads = useDownloads((state) => state.tasks);
	const clearFinished = useDownloads((state) => state.clearFinished);

	// Os eventos do downloader são escutados no layout raiz: sair desta tela não interrompe nem perde downloads.
	const [elapsedSeconds, setElapsedSeconds] = useState(0);

	useEffect(() => {
		if (importStartedAt === null) return;

		// Calcula já na montagem: ao voltar para a tela com a importação em andamento, o tempo não recomeça do zero.
		const tick = () => setElapsedSeconds(Math.floor((Date.now() - importStartedAt) / 1000));
		tick();
		const interval = setInterval(tick, 1000);

		return () => clearInterval(interval);
	}, [importStartedAt]);

	const startDownload = async () => {
		if (!downloadUrl.trim()) {
			Alert.alert('Link vazio', 'Cole o endereço de um conteúdo que permita expressamente o download.');
			return;
		}

		setDownloadBusy(true);
		try {
			if (isYoutubePlaylistUrl(downloadUrl)) {
				const { count, playlistId, skipped } = await enqueueYoutubePlaylist(downloadUrl);
				const already = skipped > 0 ? ` ${skipped} já ${skipped === 1 ? 'estava' : 'estavam'} na biblioteca ou na fila e não ${skipped === 1 ? 'será baixada' : 'serão baixadas'} de novo.` : '';
				Alert.alert(
					'Playlist na fila',
					`${count} ${count === 1 ? 'música foi adicionada' : 'músicas foram adicionadas'} à fila. Elas baixam aos poucos, mesmo se você sair desta tela.${already}`,
					[
						{ text: 'Ok' },
						{ text: 'Abrir playlist', onPress: () => router.push({ pathname: '/playlist/[id]', params: { id: playlistId } }) },
					],
				);
			} else {
				await enqueueAuthorizedDownload(downloadUrl);
			}
			setDownloadUrl('');
		} catch (error) {
			Alert.alert('Não foi possível iniciar', error instanceof Error ? error.message : 'Erro desconhecido.');
		} finally {
			setDownloadBusy(false);
		}
	};

	// Resumo e lista curta calculados uma vez por mudança da fila (que já chega agrupada, no máx. ~2x por segundo).
	const summary = useMemo(() => {
		let active = 0, completed = 0, failed = 0;
		for (const task of downloads) {
			if (task.status === 'completed') completed++;
			else if (task.status === 'failed') failed++;
			else if (!isTerminalStatus(task.status)) active++;
		}
		const visible = [...downloads]
			.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9))
			.slice(0, VISIBLE_TASKS);
		return { active, completed, failed, total: downloads.length, visible };
	}, [downloads]);

	// A importação roda no store: continua mesmo se você sair desta página.
	const run = () => void useImport.getState().start();

	return (
		<Screen title="Importar" subtitle="Adicione MP3s ou playlists de arquivos ZIP">
			<View style={styles.card}>
				<Button
					label={busy ? 'Importando…' : 'Selecionar arquivos'}
					icon="folder-open-outline"
					onPress={run}
					disabled={busy}
				/>
				{importStartedAt !== null ? (
					<View style={styles.progress}>
						<ActivityIndicator size="small" color={colors.accent} />
						<Text style={styles.progressText}>Importando · {formatElapsed(elapsedSeconds)}</Text>
					</View>
				) : null}
			</View>

			{last ? (
				<>
					<SectionHeader title="Última importação" />
					<View style={styles.result}>
						<Text style={styles.resultLine}>Importadas: {last.imported.length}</Text>
						<Text style={styles.resultLine}>Já existentes: {last.skipped}</Text>
						{last.playlistId ? <Text style={styles.resultLine}>Playlist criada ou atualizada.</Text> : null}
						{last.playlistId ? (
							<Button
								label="Abrir playlist"
								icon="musical-notes-outline"
								onPress={() => router.push({ pathname: '/playlist/[id]', params: { id: last.playlistId! } })}
							/>
						) : null}
						{last.errors.length > 0 ? (
							<Text style={[styles.resultLine, { color: colors.danger }]}>Erros: {last.errors.length}</Text>
						) : null}
					</View>
				</>
			) : null}

			<SectionHeader title="Baixar conteúdo autorizado" />
			<View style={styles.card}>
				<Text style={styles.fieldLabel}>Link direto ou playlist do YouTube</Text>
				<TextInput
					value={downloadUrl}
					onChangeText={setDownloadUrl}
					placeholder="https://..."
					placeholderTextColor={colors.faint}
					autoCapitalize="none"
					autoCorrect={false}
					keyboardType="url"
					style={styles.urlInput}
				/>
				<Button label={downloadBusy ? 'Adicionando…' : 'Adicionar à fila'} icon="download-outline" onPress={startDownload} loading={downloadBusy} disabled={downloadBusy} />
				<Text style={styles.note}>Use apenas links de conteúdos próprios, em domínio público ou cujo titular autorize o download. Links do Spotify não são fontes de áudio para download.</Text>
			</View>

			<SectionHeader title="Fila de downloads" action={summary.completed + summary.failed > 0 || downloads.some((task) => task.status === 'cancelled') ? 'Limpar concluídos' : undefined} onAction={clearFinished} />
			{summary.total > 0 ? (
				<View style={styles.summary}>
					<Text style={styles.summaryText}>
						{summary.completed} de {summary.total} concluídas
						{summary.active > 0 ? ` · ${summary.active} em andamento/na fila` : ''}
						{summary.failed > 0 ? ` · ${summary.failed} com falha` : ''}
					</Text>
					<View style={styles.summaryTrack}>
						<View style={[styles.summaryFill, { width: `${Math.round((summary.completed / summary.total) * 100)}%` }]} />
					</View>
					<View style={styles.summaryActions}>
						{summary.active > 0 ? (
							<Button
								label="Cancelar todos"
								variant="ghost"
								style={{ flex: 1 }}
								onPress={() => Alert.alert('Cancelar downloads', `Cancelar ${summary.active} ${summary.active === 1 ? 'download' : 'downloads'} em andamento e na fila?`, [
									{ text: 'Não', style: 'cancel' },
									{ text: 'Cancelar todos', style: 'destructive', onPress: () => void cancelAllDownloads() },
								])}
							/>
						) : null}
						{summary.failed > 0 ? (
							<Button label={`Tentar ${summary.failed} falha${summary.failed === 1 ? '' : 's'} de novo`} variant="ghost" style={{ flex: 1 }} onPress={() => retryDownloads()} />
						) : null}
					</View>
				</View>
			) : null}
			{summary.visible.length > 0 ? (
				<>
					{summary.visible.map((task) => <DownloadRow key={task.id} task={task} />)}
					{summary.total > VISIBLE_TASKS ? <Text style={styles.note}>Mostrando {VISIBLE_TASKS} de {summary.total}. As demais continuam normalmente.</Text> : null}
				</>
			) : (
				<View style={styles.emptyDownloads}><Ionicons name="cloud-download-outline" size={24} color={colors.faint} /><Text style={styles.note}>Nenhum download na fila.</Text></View>
			)}

			<Text style={styles.note}>Os arquivos selecionados são copiados para o armazenamento local do app. O original permanece no dispositivo.</Text>
		</Screen>
	);
}

const styles = StyleSheet.create({
	card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
	fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
	urlInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, color: colors.text, fontSize: 14 },
	downloadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
	downloadInfo: { flex: 1, gap: 3 },
	downloadTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
	downloadMeta: { color: colors.muted, fontSize: 12 },
	downloadError: { color: colors.danger, fontSize: 11 },
	summary: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
	summaryText: { color: colors.text, fontSize: 13, fontWeight: '700' },
	summaryTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
	summaryFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
	summaryActions: { flexDirection: 'row', gap: spacing.sm },
	emptyDownloads: { alignItems: 'center', gap: 6, padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md },
	result: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4 },
	resultLine: { color: colors.text, fontSize: 14 },
	info: { gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
	infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
	infoText: { color: colors.text, fontSize: 14, flex: 1 },
	progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingTop: spacing.sm },
	progressText: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
	note: { color: colors.muted, fontSize: 12.5, lineHeight: 18, marginTop: spacing.md },
});
