import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { Layout } from './components/Layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { ProjectDetail } from './pages/ProjectDetail'
import { FormEditor } from './pages/FormEditor'
import { RecordDetail } from './pages/RecordDetail'
import { SignPage } from './pages/SignPage'

function Protected({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenMessage text="Loading…" />
  if (!session) return <Navigate to="/login" replace />
  return children
}

function FullScreenMessage({ text }: { text: string }) {
  return <div className="grid min-h-screen place-items-center text-cti-gray">{text}</div>
}

export default function App() {
  return (
    <Routes>
      {/* Public signer route — no auth, no admin chrome */}
      <Route path="/sign/:token" element={<SignPage />} />

      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <Protected>
            <Layout>
              <Dashboard />
            </Layout>
          </Protected>
        }
      />
      <Route
        path="/projects/:projectId"
        element={
          <Protected>
            <Layout>
              <ProjectDetail />
            </Layout>
          </Protected>
        }
      />
      <Route
        path="/forms/:formId/edit"
        element={
          <Protected>
            <Layout>
              <FormEditor />
            </Layout>
          </Protected>
        }
      />
      <Route
        path="/records/:recordId"
        element={
          <Protected>
            <Layout>
              <RecordDetail />
            </Layout>
          </Protected>
        }
      />

      <Route path="*" element={<Navigate to={isConfigured ? '/' : '/login'} replace />} />
    </Routes>
  )
}
