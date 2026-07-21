import { useState } from 'react'
import { PageHeader } from '../components/Layout'
import { defaultSettings, getAppSettings, resetAppSettings, saveAppSettings, setStaffName } from '../lib/settings'

export function Settings() {
  const [displayName, setDisplayName] = useState(() => getAppSettings().staffName)
  const [profileSaved, setProfileSaved] = useState(false)

  const [organizationName, setOrganizationName] = useState(() => getAppSettings().organizationName)
  const [supportEmail, setSupportEmail] = useState(() => getAppSettings().supportEmail)
  const [defaultSignatureMessage, setDefaultSignatureMessage] = useState(
    () => getAppSettings().defaultSignatureMessage,
  )
  const [saved, setSaved] = useState(false)

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    setStaffName(displayName.trim() || defaultSettings.staffName)
    setProfileSaved(true)
    window.setTimeout(() => setProfileSaved(false), 1800)
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    saveAppSettings({
      ...getAppSettings(),
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
    setDisplayName(defaultSettings.staffName)
    setOrganizationName(defaultSettings.organizationName)
    setSupportEmail(defaultSettings.supportEmail)
    setDefaultSignatureMessage(defaultSettings.defaultSignatureMessage)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1800)
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your Profile and App Configuration" />

      <div className="max-w-2xl space-y-6">
        <form onSubmit={saveProfile} className="card space-y-5 p-6">
          <div>
            <h2 className="font-heading text-base font-bold text-cti-black">Your Profile</h2>
            <p className="mt-1 text-sm text-cti-gray">Shown as "Signed in As" in the profile menu.</p>
          </div>
          <div>
            <label className="label">Display Name</label>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="CTI Staff"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primary">Save Profile</button>
            {profileSaved && <span className="text-sm font-semibold text-cti-ink">Saved</span>}
          </div>
        </form>

        <form onSubmit={save} className="card space-y-5 p-6">
          <div>
            <h2 className="font-heading text-base font-bold text-cti-black">App Configuration</h2>
          </div>
          <div>
            <label className="label">Organization Name</label>
            <input
              className="input"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="CTI"
            />
          </div>

          <div>
            <label className="label">Support Email</label>
            <input
              className="input"
              type="email"
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              placeholder="name@company.com"
            />
          </div>

          <div>
            <label className="label">Default Signature Request Message</label>
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
            <button className="btn-primary">Save Settings</button>
            <button type="button" className="btn-ghost" onClick={reset}>
              Reset Defaults
            </button>
            {saved && <span className="text-sm font-semibold text-cti-ink">Saved</span>}
          </div>
        </form>
      </div>
    </>
  )
}
