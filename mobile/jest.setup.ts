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
