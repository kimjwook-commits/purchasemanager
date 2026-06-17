import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import koKR from 'antd/locale/ko_KR'
import dayjs from 'dayjs'
import 'dayjs/locale/ko'

import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ExportersPage from './pages/ExportersPage'
import BreweriesPage from './pages/BreweriesPage'
import ProductsPage from './pages/ProductsPage'
import PlanningPage from './pages/PlanningPage'
import ForecastPage from './pages/ForecastPage'
import KanbanPage from './pages/KanbanPage'
import PurchaseOrdersPage from './pages/PurchaseOrdersPage'
import ContainerPlanPage from './pages/ContainerPlanPage'
import SupplyPricesPage from './pages/SupplyPricesPage'
import ShipmentsPage from './pages/ShipmentsPage'
import RolesPage from './pages/RolesPage'

dayjs.locale('ko')

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('pm_token')
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <ConfigProvider
      locale={koKR}
      theme={{
        token: {
          colorPrimary: '#1a1a2e',
          borderRadius: 6,
        },
      }}
    >
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
            <Route path="/" element={<DashboardPage />} />
            <Route path="/exporters" element={<ExportersPage />} />
            <Route path="/breweries" element={<BreweriesPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/planning" element={<PlanningPage />} />
            <Route path="/forecast" element={<ForecastPage />} />
            <Route path="/kanban" element={<KanbanPage />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/container-plan" element={<ContainerPlanPage />} />
            <Route path="/supply-prices" element={<SupplyPricesPage />} />
            <Route path="/shipments" element={<ShipmentsPage />} />
            <Route path="/roles" element={<RolesPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  )
}
