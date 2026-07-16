import { useState } from 'react'
import { PageHeader } from '../components/Layout'
import { functionsBase, isConfigured } from '../lib/supabase'
import { defaultSettings, getAppSettings, resetAppSettings, saveAppSettings } from '../lib/settings'

export function Settings() {
  const [organizationName, setOrganizationName] = useState(() => getAppSettings().organizationName)
  const [supportEmail, setSupportEmail] = useState(() => getAppSettings().supportEmail)
  const [defaultSignatureMessage, setDefaultSignatureMessage] = useState(
    () => getAppSettings().defaultSignatureMessage,
  )
  const [saved, setSaved] = useState(false)

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    saveAppSettings({
      organizationName: organizationName.trim() || defaultSettings.organizationName,
      supportEmail: supportEmail.trim(),
      defaultSignatureMessage:
        defaultSignatureMessage.trim() || defaultSettings.defaultSignatureMessage,
    })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  const reset = () => {
    resetAppSettings()
    setOrganizationName(defaultSettings.organizationName)
    setSupportEmail(defaultSettings.supportEmail)
    setDefaultSignatureMessage(defaultSettings.defaultSignatureMessage)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Staff preferences and app configuration" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={save} className="card space-y-5 p-6">
          <div>
            <label className="label">Organization name</label>
            <input
              className="input"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="CTI"
            />
          </div>

          <div>
            <label className="label">Support email</label>
            <input
              className="input"
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label className="label">Default signature request message</label>
            <textarea
              className="input min-h-28"
              value={defaultSignatureMessage}
              onChange={(e) => setDefaultSignatureMessage(e.target.value)}
            />
            <p className="mt-2 text-xs text-cti-gray">
              This message pre-fills new signature requests. You can still edit it before creating a record.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary">Save settings</button>
            <button type="button" className="btn-ghost" onClick={reset}>
              Reset defaults
            </button>
            {saved && <span className="text-sm font-semibold text-cti-ink">Saved</span>}
          </div>
        </form>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="font-heading text-base font-bold text-cti-black">App status</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <StatusRow label="Supabase" value={isConfigured ? 'Configured' : 'Missing env vars'} />
              <StatusRow label="Base path" value={import.meta.env.BASE_URL} />
              <StatusRow label="Functions" value={functionsBase || 'Not configured'} />
            </dl>
          </section>

          <section className="card p-5 text-sm text-cti-gray">
            <h2 className="font-heading text-base font-bold text-cti-black">Deployment notes</h2>
            <p className="mt-3">
              Email sender, Supabase service keys, and OneDrive secrets are managed outside the browser in Supabase or deployment secrets.
            </p>
          </section>
        </aside>
      </div>
    </>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-cti-gray">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-cti-ink">{value}</dd>
    </div>
  )
}
