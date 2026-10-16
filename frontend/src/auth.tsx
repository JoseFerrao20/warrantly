import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { api, getToken, setToken, setUnauthorizedHandler } from './api'
import type { User } from './types'
import { AuthContext, useAuth } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => getToken() !== null)
  const [notice, setNotice] = useState<string | null>(null)

  const logout = useCallback(() => {
    void api.logout() // o refresh token (cookie) deixa de servir
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) return
    api
      .me()
      .then(setUser)
      .catch(logout)
      .finally(() => setLoading(false))
  }, [logout])

  const login = useCallback(async (email: string, password: string) => {
    setToken(await api.login(email, password))
    setNotice(null)
    setUser(await api.me())
  }, [])

  const register = useCallback(
    async (email: string, password: string, fullName: string | null) => {
      await api.register(email, password, fullName)
      await login(email, password)
    },
    [login],
  )

  const updateProfile = useCallback(async (fullName: string | null) => {
    setUser(await api.updateMe({ full_name: fullName }))
  }, [])

  const deleteAccount = useCallback(
    async (password: string) => {
      await api.deleteMe(password)
      setNotice('A tua conta foi apagada.')
      logout()
    },
    [logout],
  )

  const value = useMemo(
    () => ({ user, loading, notice, login, register, updateProfile, deleteAccount, logout }),
    [user, loading, notice, login, register, updateProfile, deleteAccount, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Só mostra o conteúdo com sessão iniciada; caso contrário, vai para o login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <p className="page-message">A carregar…</p>
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  return children
}
