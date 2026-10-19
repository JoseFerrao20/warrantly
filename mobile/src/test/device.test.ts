import * as Device from 'expo-device'
import { Platform } from 'react-native'

import { deviceName } from '@/lib/device'

const mocked = Device as { modelName?: string | null }

afterEach(() => {
  delete mocked.modelName
})

test('junta o modelo e o sistema', () => {
  mocked.modelName = 'Pixel 8'
  const system = Platform.OS === 'ios' ? 'iOS' : 'Android'

  expect(deviceName()).toBe(`Pixel 8 (${system})`)
})

test('sem modelo, fica só o sistema', () => {
  mocked.modelName = null

  expect(deviceName()).toMatch(/^(iOS|Android)$/)
})

test('tira o que não é ASCII (não passa num cabeçalho HTTP)', () => {
  mocked.modelName = 'Galáxia S26 ✨'

  expect(deviceName()).toMatch(/^Galxia S26 \((iOS|Android)\)$/)
})
