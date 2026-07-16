import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Logo } from './Logo'
import { useAuth } from '../lib/auth'

export function Layout({ children }: { children: ReactNode }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-cti-bg lg:flex">
      <aside className="hidden w-72 shrink-0 border-r border-cti-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="border-b border-cti-line px-6 py-5">
          <Link to="/" aria-label="CTI eSign home">
            <Logo />
          </Link>
        </div>

        {session && (
          <>
            <nav className="flex-1 space-y-1 px-4 py-5">
              <SidebarItem to="/" icon="P">Projects</SidebarItem>
              <SidebarItem to="/settings" icon="S">Settings</SidebarItem>
            </nav>
            <div className="border-t border-cti-line p-4">
              <p className="mb-3 truncate text-xs font-semibold text-cti-gray">{session.user.email}</p>
              <button className="btn-ghost w-full" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-cti-line bg-white lg:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link to="/" aria-label="CTI eSign home">
              <Logo />
            </Link>
            {session && (
              <button className="btn-ghost" onClick={handleSignOut}>
                Sign out
              </button>
            )}
          </div>
          {session && (
            <nav className="flex gap-2 overflow-x-auto border-t border-cti-line px-4 py-2">
              <MobileItem to="/">Projects</MobileItem>
              <MobileItem to="/settings">Settings</MobileItem>
            </nav>
          )}
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}

function SidebarItem({ to, icon, children }: { to: string; icon: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors',
          isActive ? 'bg-cti-red text-white shadow-sm' : 'text-cti-ink hover:bg-cti-bg',
        ].join(' ')
      }
    >
      <span className="grid h-7 w-7 place-items-center rounded bg-white/20 text-xs font-bold">{icon}</span>
      {children}
    </NavLink>
  )
}

function MobileItem({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
          isActive ? 'bg-cti-red text-white' : 'bg-cti-bg text-cti-ink',
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
