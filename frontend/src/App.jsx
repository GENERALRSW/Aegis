import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import DashboardLayout from './components/DashboardLayout.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Overview from './pages/Overview.jsx'
import AlertFeed from './pages/AlertFeed.jsx'
import CameraManagement from './pages/CameraManagement.jsx'
import IncidentDetail from './pages/IncidentDetail.jsx'
import MissingPersons from './pages/MissingPersons.jsx'
import NLQuery from './pages/NLQuery.jsx'
import IncidentReports from './pages/IncidentReports.jsx'
import Analytics from './pages/Analytics.jsx'
import Settings from './pages/Settings.jsx'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes — redirect to /login if no token */}
        <Route path="/" element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview"        element={<Overview />} />
          <Route path="alerts"          element={<AlertFeed />} />
          <Route path="alerts/:id"      element={<IncidentDetail />} />
          <Route path="cameras"         element={<CameraManagement />} />
          <Route path="missing-persons" element={<MissingPersons />} />
          <Route path="query"           element={<NLQuery />} />
          <Route path="analytics"       element={<Analytics />} />
          <Route path="reports"         element={<IncidentReports />} />
          <Route path="settings"        element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
