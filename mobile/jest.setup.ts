// Guardar o token num sítio seguro do telemóvel: nos testes, num mapa em memória.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
    __reset: () => store.clear(),
  }
})

// O FormData do Node transforma { uri, name, type } em texto; no telemóvel é o do React Native.
global.FormData = jest.requireActual('react-native/Libraries/Network/FormData').default

// Um build da app (não a Expo Go), com projeto do EAS, num telemóvel a sério.
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants')
  const constants = {
    ...actual.default,
    executionEnvironment: 'standalone',
    expoConfig: { ...actual.default.expoConfig, extra: { eas: { projectId: 'projeto-teste' } } },
  }
  return { __esModule: true, ...actual, default: constants }
})
jest.mock('expo-device', () => ({ isDevice: true }))

// Descarregar a fatura e abri-la: ficheiros e partilha simulados (o teste vê os pedidos).
jest.mock('expo-file-system', () => {
  class File {
    uri: string
    exists = false
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}${name}`
    }
    create() {}
    delete() {}
    write = jest.fn(async (_content: Uint8Array) => {})
    static downloadFileAsync = jest.fn(async (_url: string, destination: File) => destination)
  }
  return { File, Paths: { cache: { uri: 'file:///cache/' } } }
})
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }))
// O email do telemóvel: disponível e "enviado", a não ser que o teste diga outra coisa.
jest.mock('expo-mail-composer', () => ({
  MailComposerStatus: { SENT: 'sent', SAVED: 'saved', CANCELLED: 'cancelled' },
  isAvailableAsync: jest.fn(async () => true),
  composeAsync: jest.fn(async () => ({ status: 'sent' })),
}))

// Notificações simuladas: autorização dada, um token fixo, e `__tap(data)` simula tocar numa.
jest.mock('expo-notifications', () => {
  const { useSyncExternalStore } = jest.requireActual('react')
  let lastResponse: unknown = null
  const listeners = new Set<() => void>()
  const setResponse = (response: unknown) => {
    lastResponse = response
    listeners.forEach((listener) => listener())
  }
  return {
    AndroidImportance: { HIGH: 4 },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ granted: true })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    getExpoPushTokenAsync: jest.fn(async () => ({
      type: 'expo',
      data: 'ExponentPushToken[telemovel]',
    })),
    useLastNotificationResponse: () =>
      useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        () => lastResponse,
      ),
    clearLastNotificationResponse: jest.fn(() => setResponse(null)),
    __tap: (data: Record<string, unknown>) =>
      setResponse({ notification: { request: { content: { data } } } }),
  }
})

// Câmara para o código QR: autorizada, a não ser que o teste mude `__setPermission`. A
// CameraView é uma View; o teste simula uma leitura com fireEvent(câmara, 'barcodeScanned', …).
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual('react-native')
  const { createElement, useState } = jest.requireActual('react')
  let permission = { granted: true, canAskAgain: true }
  const requestCameraPermissionsAsync = jest.fn(async () => permission)
  return {
    CameraView: (props: object) => createElement(View, props),
    useCameraPermissions: () => {
      const [current, setCurrent] = useState(permission)
      const request = async () => {
        const result = await requestCameraPermissionsAsync()
        setCurrent(result)
        return result
      }
      return [current, request]
    },
    requestCameraPermissionsAsync,
    __setPermission: (value: typeof permission) => {
      permission = value
    },
  }
})
