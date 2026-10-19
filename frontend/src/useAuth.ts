import { createContext, useContext } from 'react'

import type { User } from './types'

export interface AuthState {
  user: User | null
  loading: boolean
  /** Mensagem para mostrar no login depois de a sessão terminar (ex.: conta apagada). */
  notice: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string | null) => Promise<void>
  updateProfile: (fullName: string | null) => Promise<void>
  /** Volta a pedir o utilizador à API (ex.: depois de confirmar o email). */
  refreshUser: () => Promise<void>
  deleteAccount: (password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth tem de estar dentro de <AuthProvider>')
  return context
}
