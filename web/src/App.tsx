import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { Login } from './pages/Login'
import { Users } from './pages/Users'
import { Groups } from './pages/Groups'
import { Profile } from './pages/Profile'
import { Ldif } from './pages/Ldif'
import { Audit } from './pages/Audit'
import { Import } from './pages/Import'
import { Templates } from './pages/Templates'
import { SchemaPage } from './pages/Schema'
import { TreePage } from './pages/Tree'
import { Forgot } from './pages/Forgot'
import { Reset } from './pages/Reset'
import { Dashboard } from './pages/Dashboard'
import { Monitor } from './pages/Monitor'
import { Webhooks } from './pages/Webhooks'
import { Replication } from './pages/Replication'
import { Settings } from './pages/Settings'

export default function App() {
  const { me, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-950">
        <div className="label-mono">// loading...</div>
      </div>
    )
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<Reset />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to={me.role === 'admin' ? '/dashboard' : '/me'} replace />} />
      <Route
        path="/dashboard"
        element={me.role === 'admin' ? <Dashboard /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/monitor"
        element={me.role === 'admin' ? <Monitor /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/webhooks"
        element={me.role === 'admin' ? <Webhooks /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/users"
        element={me.role === 'admin' ? <Users /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/groups"
        element={me.role === 'admin' ? <Groups /> : <Navigate to="/me" replace />}
      />
      <Route path="/me" element={<Profile />} />
      <Route
        path="/ldif"
        element={me.role === 'admin' ? <Ldif /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/audit"
        element={me.role === 'admin' ? <Audit /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/import"
        element={me.role === 'admin' ? <Import /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/templates"
        element={me.role === 'admin' ? <Templates /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/schema"
        element={me.role === 'admin' ? <SchemaPage /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/tree"
        element={me.role === 'admin' ? <TreePage /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/replication"
        element={me.role === 'admin' ? <Replication /> : <Navigate to="/me" replace />}
      />
      <Route
        path="/settings"
        element={me.role === 'admin' ? <Settings /> : <Navigate to="/me" replace />}
      />
      <Route path="/login" element={<Navigate to={me.role === 'admin' ? '/users' : '/me'} replace />} />
      <Route path="/forgot" element={<Forgot />} />
      <Route path="/reset" element={<Reset />} />
      <Route path="*" element={<Navigate to={me.role === 'admin' ? '/users' : '/me'} replace />} />
    </Routes>
  )
}
