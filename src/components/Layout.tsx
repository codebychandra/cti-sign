import { Link, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { useAuth } from '../lib/auth'

export function Layout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-cti-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/">
            <Logo />
          </Link>
          {session && (
            <div className="flex items-center gap-4 text-sm">
              <span className="hidden text-cti-gray sm:inline">{session.user.email}</span>
              <button
                className="btn-ghost"
                onClick={async () => {
                  await signOut()
                  navigate('/login')
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-bold text-cti-black">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-cti-gray">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
