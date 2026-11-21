import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT, colors } from '@/constants/theme';
import { hidesTabBar, useKeyboardVisible } from '@/lib/layout';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; href: '/' | '/library' | '/add' | '/stats' | '/profile'; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', href: '/', title: 'Início', icon: 'home-outline', iconActive: 'home' },
  { name: 'library', href: '/library', title: 'Biblioteca', icon: 'library-outline', iconActive: 'library' },
  { name: 'add', href: '/add', title: 'Importar', icon: 'add-circle-outline', iconActive: 'add-circle' },
  { name: 'stats', href: '/stats', title: 'Estatísticas', icon: 'stats-chart-outline', iconActive: 'stats-chart' },
  { name: 'profile', href: '/profile', title: 'Perfil', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

export function TabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const keyboardVisible = useKeyboardVisible();
  if (hidesTabBar(pathname) || keyboardVisible) return null;
  const activeName = pathname === '/' ? 'index' : pathname.slice(1).split('/')[0];

  return (
    <View style={[styles.bar, { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const focused = activeName === tab.name;
        const onPress = () => router.navigate(tab.href);
        return (
          <Pressable key={tab.name} onPress={onPress} style={styles.item} accessibilityRole="button" accessibilityLabel={tab.title}>
            <Ionicons name={focused ? tab.iconActive : tab.icon} size={23} color={focused ? colors.accent : colors.muted} />
            <Text style={[styles.label, { color: focused ? colors.accent : colors.muted }]}>{tab.title}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 10.5, fontWeight: '700' },
});
