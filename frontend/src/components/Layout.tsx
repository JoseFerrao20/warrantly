import { Link, Outlet } from 'react-router'

import { useAuth } from '../useAuth'

export function Layout() {
  const { user, logout } = useAuth()
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          Warrantly
        </Link>
        <div className="topbar-actions">
          <Link to="/conta" className="topbar-user" title="A tua conta">
            {user?.email}
          </Link>
          <button type="button" className="button-link" onClick={logout}>
            Sair
          </button>
          <Link to="/compras/nova" className="button button-primary">
            + Nova
          </Link>
        </div>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </>
  )
}
