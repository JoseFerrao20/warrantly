import { useEffect, useRef } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { useAuth } from '../useAuth'
import { VerifyEmailBanner } from './VerifyEmailBanner'

export function Layout() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  const previousPath = useRef(pathname)

  // Ao mudar de página, o foco passa para o conteúdo novo (como numa página normal),
  // em vez de ficar no link que já não existe. Compara com o caminho anterior em vez de
  // saltar o primeiro efeito, porque o StrictMode corre os efeitos duas vezes.
  useEffect(() => {
    if (previousPath.current === pathname) return
    previousPath.current = pathname
    main.current?.focus()
  }, [pathname])

  return (
    <>
      <a href="#conteudo" className="skip-link">
        Saltar para o conteúdo
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          Warrantly
        </Link>
        <nav className="topbar-actions" aria-label="Principal">
          <Link to="/conta" className="topbar-user topbar-wide">
            {user?.email}
          </Link>
          {/* No telemóvel não há espaço para o email. */}
          <Link to="/conta" className="topbar-user topbar-narrow">
            Conta
          </Link>
          <button type="button" className="button-link" onClick={logout}>
            Sair
          </button>
          <Link to="/compras/nova" className="button button-primary">
            + Nova
          </Link>
        </nav>
      </header>
      <main id="conteudo" className="container" tabIndex={-1} ref={main}>
        {user && !user.email_verified && <VerifyEmailBanner email={user.email} />}
        <Outlet />
      </main>
    </>
  )
}
