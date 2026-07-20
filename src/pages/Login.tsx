import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Logo } from '../components/Logo'

export function Login() {
  const { session, login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await login(password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cti-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6">
          <h1 className="mb-1 font-heading text-xl font-bold text-cti-black">Sign in</h1>
          <p className="mb-5 text-sm text-cti-gray">CTI staff access</p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-cti-red">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
