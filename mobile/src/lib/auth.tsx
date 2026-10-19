import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { api, getToken, setSession, setUnauthorizedHandler } from './api'
import { unregisterPush } from './push'
import type { User } from '@/shared/types'

interface AuthState {
  /** undefined: ainda a ler o token guardado; null: sem sessão. */
  user: User | null | undefined
  /** Mensagem para o ecrã de entrada depois de a sessão acabar (ex.: conta apagada). */
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  /** Cria a conta e entra logo (o email de confirmação segue pela API). */
  register: (email: string, password: string, fullName: string | null) => Promise<void>
  logout: () => Promise<void>
  /** Apaga a conta (pede a palavra-passe) e volta ao ecrã de entrada. */
  deleteAccount: (password: string) => Promise<void>
  /** Muda o nome da conta (assina as reclamações). */
  updateName: (fullName: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)

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
    setNotice(null)
    setUser(await api.me())
  }, [])

  const register = useCallback(
    async (email: string, password: string, fullName: string | null) => {
      await api.register(email.trim().toLowerCase(), password, fullName?.trim() || null)
      await login(email, password)
    },
    [login],
  )

  // A API apaga as sessões, os tokens de push e as faturas com a conta: aqui só se esquecem
  // os tokens deste telemóvel.
  const deleteAccount = useCallback(
    async (password: string) => {
      await api.deleteMe(password)
      setNotice('A tua conta foi apagada.')
      await endSession()
    },
    [endSession],
  )

  const updateName = useCallback(async (fullName: string) => {
    setUser(await api.updateMe({ full_name: fullName.trim() || null }))
  }, [])

  const value = useMemo(
    () => ({ user, notice, login, register, logout, deleteAccount, updateName }),
    [user, notice, login, register, logout, deleteAccount, updateName],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth fora do AuthProvider')
  return context
}
