import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface ConnectionInfo {
  folder_id: string | null
  folder_path: string | null
  account_email: string | null
}

export function OneDriveConnectPanel({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<ConnectionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.get<ConnectionInfo>('onedrive-connections', projectId)
      setInfo(data)
    } catch {
      setInfo(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [projectId])

  const connect = () => {
    const tenantId = import.meta.env.VITE_MS_TENANT_ID
    const clientId = import.meta.env.VITE_MS_CLIENT_ID
    if (!tenantId || !clientId) return setError('Microsoft app is not configured yet.')
    const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL}oauth/onedrive/callback`
    const state = crypto.randomUUID()
    sessionStorage.setItem('onedrive_oauth', JSON.stringify({ state, projectId, redirectUri }))
    const url = new URL(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('response_mode', 'query')
    url.searchParams.set('scope', 'offline_access Files.ReadWrite')
    url.searchParams.set('state', state)
    window.location.href = url.toString()
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect OneDrive from this project?')) return
    setError(null)
    try {
      await api.onedrive({ action: 'disconnect', project_id: projectId })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return null

  return (
    <div className="card space-y-3 p-5">
      <h2 className="font-heading text-base font-bold text-cti-black">OneDrive</h2>
      {error && <p className="text-sm text-cti-red">{error}</p>}
      {!info ? (
        <>
          <p className="text-sm text-cti-gray">Connect a OneDrive account so completed PDFs save there automatically.</p>
          <button className="btn-primary w-full" type="button" onClick={connect}>Connect to OneDrive</button>
        </>
      ) : (
        <>
          <p className="text-sm text-cti-ink">
            Connected as <span className="font-semibold">{info.account_email ?? 'unknown account'}</span>
          </p>
          <p className="text-sm text-cti-gray">
            Folder: {info.folder_path ? <span className="font-semibold text-cti-ink">{info.folder_path}</span> : <span className="italic">Not Selected</span>}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" type="button" onClick={() => setBrowsing(true)}>
              {info.folder_path ? 'Change Folder' : 'Choose Folder'}
            </button>
            <button className="btn-ghost text-cti-red" type="button" onClick={disconnect}>Disconnect</button>
          </div>
        </>
      )}
      {browsing && (
        <FolderBrowser
          projectId={projectId}
          onClose={() => setBrowsing(false)}
          onSelected={() => {
            setBrowsing(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function FolderBrowser({ projectId, onClose, onSelected }: { projectId: string; onClose: () => void; onSelected: () => void }) {
  const [stack, setStack] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'OneDrive' }])
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const current = stack[stack.length - 1]

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.onedrive({ action: 'list-folders', project_id: projectId, folder_id: current.id ?? undefined })
      .then((data) => {
        if (cancelled) return
        setFolders(data.folders ?? [])
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error).message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, current.id])

  const selectHere = async () => {
    const path = stack.map((s) => s.name).join('/')
    try {
      await api.onedrive({ action: 'select-folder', project_id: projectId, folder_id: current.id ?? 'root', folder_path: path })
      onSelected()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="card w-full max-w-md space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h3 className="font-heading font-bold text-cti-black">Choose a Folder</h3>
          <button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="truncate text-xs text-cti-gray">{stack.map((s) => s.name).join(' / ')}</p>
        {error && <p className="text-sm text-cti-red">{error}</p>}
        <div className="max-h-64 space-y-1 overflow-auto">
          {stack.length > 1 && (
            <button className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-cti-bg" type="button" onClick={() => setStack((s) => s.slice(0, -1))}>
              .. Up One Level
            </button>
          )}
          {loading ? (
            <p className="p-3 text-sm text-cti-gray">Loading...</p>
          ) : folders.length === 0 ? (
            <p className="p-3 text-sm text-cti-gray">No Subfolders Here.</p>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-cti-bg"
                type="button"
                onClick={() => setStack((s) => [...s, { id: f.id, name: f.name }])}
              >
                {f.name}
              </button>
            ))
          )}
        </div>
        <button className="btn-primary w-full" type="button" onClick={selectHere}>Use This Folder</button>
      </div>
    </div>
  )
}
