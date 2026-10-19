import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { api, getToken, refreshAccessToken, setToken, setUnauthorizedHandler } from './api'
import type { User } from './types'
import { AuthContext, useAuth } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // Ao abrir a página ainda não se sabe se há sessão: o cookie do refresh token é que diz.
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  const logout = useCallback(() => {
    void api.logout() // o refresh token (cookie) deixa de servir
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    try {
      localStorage.removeItem('warrantly.token') // versões antigas guardavam-no aqui
    } catch {
      // Sem localStorage (ex.: modo privado restrito): não há nada para apagar.
    }
    // O token de acesso só existe em memória: numa página acabada de abrir, pede-se um novo
    // com o cookie. Sem sessão (sem cookie, ou já terminada), fica no login.
    const token = getToken() ? Promise.resolve(getToken()) : refreshAccessToken()
    token
      .then((value) => (value ? api.me().then(setUser) : undefined))
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

  const refreshUser = useCallback(async () => {
    if (getToken()) setUser(await api.me())
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
    () => ({
      user,
      loading,
      notice,
      login,
      register,
      updateProfile,
      refreshUser,
      deleteAccount,
      logout,
    }),
    [user, loading, notice, login, register, updateProfile, refreshUser, deleteAccount, logout],
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
