import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

interface Session {
  token: string
}

interface AuthState {
  session: Session | null
  loading: boolean
  login: (password: string) => Promise<{ error: string | null }>
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    setSession(token ? { token } : null)
    setLoading(false)
  }, [])

  const login = async (password: string) => {
    try {
      const { token } = await api.login(password)
      setToken(token)
      setSession({ token })
      return { error: null }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }

  const logout = () => {
    setToken(null)
    setSession(null)
  }

  return <AuthContext.Provider value={{ session, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
