import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, getToken, setSession, setUnauthorizedHandler } from './api'
import { unregisterPush } from './push'
import type { User } from '@/shared/types'

interface AuthState {
  /** undefined: ainda a ler o token guardado; null: sem sessão. */
  user: User | null | undefined
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  // Sessão terminada (o refresh token já não serve): só esquece os tokens. O telemóvel continua
  // a receber os alertas da conta, porque a pessoa não saiu; ao entrar outra vez, o push volta
  // a registar-se.
  const endSession = useCallback(async () => {
    await setSession(null)
    setUser(null)
  }, [])

  // "Sair": este telemóvel deixa de receber os alertas e a sessão é revogada na API.
  const logout = useCallback(async () => {
    await unregisterPush().catch(() => {}) // sem rede, sai na mesma
    await api.logout().catch(() => {})
    await endSession()
  }, [endSession])

  useEffect(() => {
    setUnauthorizedHandler(() => void endSession())
    // Ao abrir a app: há um token guardado e ainda é válido?
    getToken()
      .then((token) => (token ? api.me() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [endSession])

  const login = useCallback(async (email: string, password: string) => {
    await setSession(await api.login(email.trim().toLowerCase(), password))
    setUser(await api.me())
  }, [])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth fora do AuthProvider')
  return context
}
