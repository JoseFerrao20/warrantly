import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, getToken, setToken, setUnauthorizedHandler } from './api'
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

  const logout = useCallback(async () => {
    await setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(() => void logout())
    // Ao abrir a app: há um token guardado e ainda é válido?
    getToken()
      .then((token) => (token ? api.me() : null))
      .then(setUser)
      .catch(() => setUser(null))
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    await setToken(await api.login(email.trim().toLowerCase(), password))
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
