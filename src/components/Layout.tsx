import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { useAuth } from '../lib/auth'

export function Layout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-cti-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/">
            <Logo />
          </Link>
          {session && (
            <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
              <nav className="flex items-center gap-1 rounded-md border border-cti-line bg-cti-bg p-1">
                <NavItem to="/">Projects</NavItem>
                <NavItem to="/settings">Settings</NavItem>
              </nav>
              <span className="hidden text-cti-gray lg:inline">{session.user.email}</span>
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

function NavItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'rounded px-3 py-1.5 text-sm font-semibold transition-colors',
          isActive ? 'bg-white text-cti-black shadow-sm' : 'text-cti-gray hover:text-cti-ink',
        ].join(' ')
      }
    >
      {children}
    </NavLink>
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
