import { useState } from 'react'
import { PageHeader } from '../components/Layout'
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

      <div className="max-w-2xl">
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
      </div>
    </>
  )
}
