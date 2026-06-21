import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'

import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import SetupPage from './pages/SetupPage'
import CompliancePage from './pages/CompliancePage'
import ForecastPage from './pages/ForecastPage'
import KanbanPage from './pages/KanbanPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import PalletPlanPage from './pages/PalletPlanPage'
import ShipmentsPage from './pages/ShipmentsPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('pm_token')
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"      element={<DashboardPage />} />
          <Route path="/setup"          element={<SetupPage />} />
          <Route path="/compliance"     element={<CompliancePage />} />
          <Route path="/forecast"       element={<ForecastPage />} />
          <Route path="/sku-board"      element={<KanbanPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/pallet-plan"    element={<PalletPlanPage />} />
          <Route path="/shipments"      element={<ShipmentsPage />} />
          <Route path="/settings"       element={<div style={{ padding: 16, color: 'var(--text-secondary)', fontSize: 13 }}>시스템 설정 (준비 중)</div>} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
