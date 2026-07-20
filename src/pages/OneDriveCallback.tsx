import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'

export function OneDriveCallback() {
  const [params] = useSearchParams()
  const [status, setStatus] = useState<'working' | 'done' | 'error'>('working')
  const [message, setMessage] = useState('Connecting to OneDrive...')
  const [projectId, setProjectId] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const code = params.get('code')
      const state = params.get('state')
      const graphError = params.get('error_description') || params.get('error')
      const raw = sessionStorage.getItem('onedrive_oauth')
      sessionStorage.removeItem('onedrive_oauth')

      if (graphError) {
        setStatus('error')
        setMessage(graphError)
        return
      }
      if (!code || !state || !raw) {
        setStatus('error')
        setMessage('Missing authorization code or session — please try connecting again.')
        return
      }
      const saved = JSON.parse(raw) as { state: string; projectId: string; redirectUri: string }
      if (saved.state !== state) {
        setStatus('error')
        setMessage('Session did not match — please try connecting again.')
        return
      }
      setProjectId(saved.projectId)

      try {
        const data = await api.onedrive({ action: 'exchange', project_id: saved.projectId, code, redirect_uri: saved.redirectUri })
        setStatus('done')
        setMessage(`Connected as ${data.account_email ?? 'your Microsoft account'}. Now choose a folder.`)
      } catch (e) {
        setStatus('error')
        setMessage((e as Error).message)
      }
    })()
  }, [params])

  return (
    <div className="grid min-h-screen place-items-center bg-cti-bg px-4">
      <div className="card w-full max-w-sm space-y-4 p-6 text-center">
        <h1 className="font-heading text-lg font-bold text-cti-black">OneDrive connection</h1>
        <p className={`text-sm ${status === 'error' ? 'text-cti-red' : 'text-cti-gray'}`}>{message}</p>
        {status !== 'working' && (
          <Link to={projectId ? `/projects/${projectId}?tab=template` : '/'} className="btn-primary w-full">
            Back to project
          </Link>
        )}
      </div>
    </div>
  )
}
