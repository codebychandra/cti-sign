import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
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
        <div className="border-b border-cti-line px-5 py-5">
          <Link to="/" aria-label="CTI eSign home">
            <Logo />
          </Link>
        </div>

        {session && (
          <>
            <nav className="flex-1 space-y-2 px-4 py-5">
              <SidebarItem to="/" icon={<ProjectsIcon />}>Projects</SidebarItem>
            </nav>
            <div className="border-t border-cti-line p-4">
              <ProfileMenu email={session.user.email ?? 'Signed in'} onSignOut={handleSignOut} />
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
            {session && <ProfileMenu email={session.user.email ?? 'Signed in'} onSignOut={handleSignOut} compact />}
          </div>
          {session && (
            <nav className="flex gap-2 overflow-x-auto border-t border-cti-line px-4 py-2">
              <MobileItem to="/" icon={<ProjectsIcon />}>Projects</MobileItem>
            </nav>
          )}
        </header>

        <main className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}

function SidebarItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm font-semibold transition-colors',
          isActive ? 'border-cti-red bg-cti-red text-white shadow-sm' : 'border-cti-line bg-white text-cti-ink hover:border-cti-gray/40 hover:bg-cti-bg',
        ].join(' ')
      }
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/20">{icon}</span>
      <span>{children}</span>
    </NavLink>
  )
}

function MobileItem({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors',
          isActive ? 'border-cti-red bg-cti-red text-white' : 'border-cti-line bg-white text-cti-ink',
        ].join(' ')
      }
    >
      {icon}
      {children}
    </NavLink>
  )
}

function ProfileMenu({ email, onSignOut, compact = false }: { email: string; onSignOut: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const initial = email.trim().charAt(0).toUpperCase() || 'U'

  return (
    <div className="relative">
      <button
        type="button"
        className={[
          'flex w-full items-center gap-3 rounded-md border border-cti-line bg-white px-3 py-2 text-left transition-colors hover:bg-cti-bg',
          compact ? 'w-auto' : '',
        ].join(' ')}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cti-black text-sm font-bold text-white">
          {initial}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold uppercase text-cti-gray">Profile</span>
            <span className="block truncate text-sm font-semibold text-cti-ink">{email}</span>
          </span>
        )}
        <ChevronIcon />
      </button>

      {open && (
        <div
          className={`absolute z-30 mt-2 w-64 rounded-md border border-cti-line bg-white p-2 shadow-lg ${compact ? 'right-0' : 'bottom-full mb-2 mt-0'}`}
          role="menu"
        >
          <div className="border-b border-cti-line px-3 py-2">
            <p className="text-xs font-semibold uppercase text-cti-gray">Signed in as</p>
            <p className="truncate text-sm font-semibold text-cti-ink">{email}</p>
          </div>
          <Link className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-cti-ink hover:bg-cti-bg" to="/settings">
            <SettingsIcon />
            Settings
          </Link>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-cti-red hover:bg-red-50"
            onClick={onSignOut}
          >
            <SignOutIcon />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function ProjectsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h3.1l2 2H17.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-10Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 9h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18.6 13.1c.1-.4.1-.7.1-1.1s0-.7-.1-1.1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.9-1.1L14 3.3h-4l-.4 2.6c-.7.3-1.3.6-1.9 1.1l-2.4-1-2 3.4 2 1.5c-.1.4-.1.7-.1 1.1s0 .7.1 1.1l-2 1.5 2 3.4 2.4-1c.6.5 1.2.8 1.9 1.1l.4 2.6h4l.4-2.6c.7-.3 1.3-.6 1.9-1.1l2.4 1 2-3.4-2.1-1.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8l4 4-4 4M18 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-cti-gray" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
