import * as Device from 'expo-device'
import { Platform } from 'react-native'

const SYSTEMS: Record<string, string> = { android: 'Android', ios: 'iOS' }

/**
 * Nome deste telemóvel para a lista de sessões da conta ("Pixel 8 (Android)"). Vai no login,
 * no cabeçalho `X-Device-Name`. É o modelo, não o nome que a pessoa deu ao telemóvel.
 */
export function deviceName(): string {
  const system = SYSTEMS[Platform.OS] ?? Platform.OS
  // Os cabeçalhos HTTP só levam ASCII com segurança.
  const model = (Device.modelName ?? '').replace(/[^\x20-\x7e]/g, '').trim()
  return model ? `${model} (${system})` : system
}
