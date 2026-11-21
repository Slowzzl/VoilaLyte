import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/constants/theme';
import { useChrome } from '@/lib/layout';
import { usePlayer } from '@/store/player-store';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export type SelectionAction = {
  icon: IconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

/** Altura aproximada da barra: use em `Screen extraBottom` para o último item não ficar escondido. */
export const SELECTION_BAR_HEIGHT = 124;

type Props = {
  count: number;
  total: number;
  hideTabBar?: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
  actions: SelectionAction[];
};

/** Barra fixa do modo de seleção: contador, "selecionar todas" e ações em lote. */
export function SelectionBar({ count, total, hideTabBar = false, onToggleAll, onCancel, actions }: Props) {
  const hasMini = usePlayer((s) => s.current !== null);
  const { contentBottom } = useChrome({ tabBar: !hideTabBar, mini: hasMini });
  const allSelected = total > 0 && count >= total;
  const disabled = count === 0;

  return (
    <View style={[styles.bar, { bottom: contentBottom }]}>
      <View style={styles.topRow}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityLabel="Sair da seleção" style={styles.close}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.count}>{count === 0 ? 'Selecione músicas' : count === 1 ? '1 selecionada' : `${count} selecionadas`}</Text>
        <Pressable onPress={onToggleAll} hitSlop={10} disabled={total === 0}>
          <Text style={styles.selectAll}>{allSelected ? 'Limpar' : `Todas (${total})`}</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            disabled={disabled}
            style={({ pressed }) => [styles.action, disabled && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
            accessibilityLabel={action.label}
          >
            <Ionicons name={action.icon} size={20} color={action.danger ? colors.danger : colors.text} />
            <Text style={[styles.actionLabel, action.danger && { color: colors.danger }]} numberOfLines={1}>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.sm,
    elevation: 8,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4 },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  count: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800' },
  selectAll: { color: colors.accent, fontSize: 13, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, minHeight: 46, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  actionLabel: { color: colors.text, fontSize: 13, fontWeight: '700', flexShrink: 1 },
});
