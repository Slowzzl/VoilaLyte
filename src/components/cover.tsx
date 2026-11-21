import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  uri?: string | null;
  /** Texto usado para gerar a cor e a inicial quando não há capa. */
  seed: string;
  size: number;
  radius?: number;
  round?: boolean;
};

function hueOf(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
  return h;
}

export function Cover({ uri, seed, size, radius = 10, round = false }: Props) {
  const borderRadius = round ? size / 2 : radius;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius, backgroundColor: '#1E2128' }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  const hue = hueOf(seed || '?');
  const initial = (seed.trim()[0] ?? '♪').toUpperCase();
  return (
    <View
      style={[
        styles.placeholder,
        { width: size, height: size, borderRadius, backgroundColor: `hsl(${hue}, 38%, 24%)` },
      ]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.42, color: `hsl(${hue}, 70%, 72%)` }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontWeight: '800' },
});
