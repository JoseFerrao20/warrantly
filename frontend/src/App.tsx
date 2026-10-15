import { Navigate, Route, Routes } from 'react-router'

import { RequireAuth } from './auth'
import { Layout } from './components/Layout'
import { AccountPage } from './pages/AccountPage'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { PurchaseDetailPage } from './pages/PurchaseDetailPage'
import { PurchaseFormPage } from './pages/PurchaseFormPage'

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="compras/nova" element={<PurchaseFormPage />} />
        <Route path="compras/:id" element={<PurchaseDetailPage />} />
        <Route path="compras/:id/editar" element={<PurchaseFormPage />} />
        <Route path="conta" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
