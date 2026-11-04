import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { setToken } from '../api'

// Os testes correm sempre no mesmo dia: as compras de exemplo (`makePurchase`) têm datas fixas,
// e o estado de cada garantia ("a expirar", "expirada") depende do dia de hoje. Sem isto, os
// testes começaram a falhar no dia seguinte ao fim da garantia de exemplo (3/11/2026). Só o
// `Date` é simulado: os temporizadores continuam reais, para o userEvent e as promessas.
export const TODAY = new Date('2026-10-01T12:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  localStorage.clear()
  setToken(null) // o token de acesso vive em memória: cada teste começa sem sessão
})
