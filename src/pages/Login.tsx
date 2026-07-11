import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isConfigured } from '../lib/supabase'
import { Logo } from '../components/Logo'

export function Login() {
  const { session, signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    const fn = mode === 'in' ? signIn : signUp
    const { error } = await fn(email, password)
    setBusy(false)
    if (error) setError(error)
    else if (mode === 'up') setInfo('Account created. If email confirmation is on, check your inbox, then sign in.')
  }

  return (
    <div className="grid min-h-screen place-items-center bg-cti-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <div className="card p-6">
          <h1 className="mb-1 font-heading text-xl font-bold text-cti-black">
            {mode === 'in' ? 'Sign in' : 'Create account'}
          </h1>
          <p className="mb-5 text-sm text-cti-gray">CTI staff access</p>

          {!isConfigured && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Supabase isn't configured yet. Add <code>VITE_SUPABASE_URL</code> and{' '}
              <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart.
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              />
            </div>
            {error && <p className="text-sm text-cti-red">{error}</p>}
            {info && <p className="text-sm text-green-700">{info}</p>}
            <button className="btn-primary w-full" disabled={busy || !isConfigured}>
              {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            className="mt-4 w-full text-center text-sm text-cti-gray hover:text-cti-ink"
            onClick={() => {
              setMode(mode === 'in' ? 'up' : 'in')
              setError(null)
              setInfo(null)
            }}
          >
            {mode === 'in' ? 'Need an account? Create one' : 'Have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  )
}
