import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { setToken } from '../api'

afterEach(() => {
  cleanup()
  localStorage.clear()
  setToken(null) // o token de acesso vive em memória: cada teste começa sem sessão
})
