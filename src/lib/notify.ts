import { Platform, ToastAndroid } from 'react-native';

/** Aviso curto e não bloqueante (toast no Android; no iOS a própria interface já mostra a mudança). */
export function notify(message: string): void {
  if (Platform.OS === 'android') ToastAndroid.show(message, ToastAndroid.SHORT);
}
