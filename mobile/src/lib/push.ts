import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { AndroidImportance } from 'expo-notifications'
import { useRouter } from 'expo-router'
import type { Href } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useEffect } from 'react'
import { Platform } from 'react-native'

import { api } from './api'

/**
 * Notificações push dos alertas de garantia (o backend envia-as pelo serviço do Expo; ver o
 * ADR 0003). Ao entrar, a app pede autorização e regista o token deste telemóvel na API; ao
 * sair (no botão "Sair"), apaga-o. Tocar numa notificação abre a compra.
 */

const PUSH_TOKEN_KEY = 'warrantly.pushToken'
export const ANDROID_CHANNEL = 'alertas' // o mesmo canal que o backend usa (app/push.py)

// Com a app aberta, o alerta aparece na mesma.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

function projectId(): string | undefined {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
}

/** Porque é que este aparelho não pode receber push (null: pode). */
export function pushUnavailableReason(): string | null {
  if (!Device.isDevice) return 'Os simuladores não recebem notificações push.'
  // Desde o SDK 53, a Expo Go no Android já não recebe push: é preciso uma development build.
  if (
    Platform.OS === 'android' &&
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  ) {
    return 'A Expo Go no Android não recebe notificações push.'
  }
  if (!projectId()) return 'Falta o projeto do EAS (extra.eas.projectId no app.json).'
  return null
}

/** Pede autorização e regista o token na API. Devolve o token, ou null se não houver push. */
export async function registerForPush(): Promise<string | null> {
  if (pushUnavailableReason()) return null
  if (Platform.OS === 'android') {
    // No Android 13+, o pedido de autorização só aparece depois de existir um canal.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Alertas de garantia',
      importance: AndroidImportance.HIGH,
    })
  }
  let { granted } = await Notifications.getPermissionsAsync()
  if (!granted) ({ granted } = await Notifications.requestPermissionsAsync())
  if (!granted) return null
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() })
  await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android')
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token)
  return token
}

/** Ao sair da conta: este telemóvel deixa de receber os alertas dela. */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY)
  if (!token) return
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY)
  await api.deletePushToken(token)
}

/** Regista o push com sessão iniciada e abre a página de uma notificação tocada. */
export function usePushNotifications(signedIn: boolean) {
  const router = useRouter()
  const response = Notifications.useLastNotificationResponse()

  useEffect(() => {
    // Sem rede ou sem o serviço do Expo, a app funciona na mesma; tenta outra vez ao abrir.
    if (signedIn) registerForPush().catch(() => null)
  }, [signedIn])

  useEffect(() => {
    if (!signedIn || !response) return
    const url = response.notification.request.content.data?.url
    Notifications.clearLastNotificationResponse() // não voltar a abrir a mesma notificação
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href)
  }, [signedIn, response, router])
}
