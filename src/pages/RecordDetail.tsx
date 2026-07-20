import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { buildSignedPdf } from '../lib/pdf'
import type { Form, Project, ProjectCustomField, ProjectType, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'

export function RecordDetail() {
  const { recordId } = useParams()
  const navigate = useNavigate()
  const [record, setRecord] = useState<SignRecord | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [projectType, setProjectType] = useState<ProjectType>('sent_signature')
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    const r = await api.get<SignRecord>('records', recordId!)
    setRecord(r)
    const [f, proj, fields] = await Promise.all([
      api.get<Form>('forms', r.form_id),
      api.get<Project>('projects', r.project_id),
      api.list<ProjectCustomField>('custom-fields', { project_id: r.project_id }),
    ])
    setForm(f)
    setProjectType(proj.project_type ?? 'sent_signature')
    setCustomFields(fields.map((field) => ({ ...field, options: normalizeOptions(field.options) })).sort((a, b) => a.sort_order - b.sort_order))
    setCustomValues(
      r.custom_values.reduce<Record<string, string>>((acc, value) => {
        acc[value.field_id] = value.value ?? ''
        return acc
      }, {}),
    )
  }, [recordId])

  useEffect(() => {
    load()
  }, [load])

  if (!record) return <p className="text-cti-gray">Loading...</p>

  const signUrl = `${window.location.origin}${import.meta.env.BASE_URL}sign/${record.token}`
  const isCompleted = record.status === 'completed'
  const isSubmitted = record.status === 'submitted'
  const isAutoPopulate = projectType === 'auto_populate'

  const markSent = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const data = await api.sendSignatureRequest(record.id, appBaseUrl())
      setMsg(data.emailed === false ? 'No email provider configured. The record was marked sent for manual sharing.' : 'Signature email sent to the signer.')
    } catch (e) {
      setMsg((e as Error).message)
    }
    setBusy(false)
    load()
  }

  const markComplete = async () => {
    setBusy(true)
    setMsg(null)
    await api.update('records', record.id, { status: 'completed', completed_at: new Date().toISOString() })
    try {
      await api.onedrive({ action: 'upload', record_id: record.id })
      setMsg('Record marked complete.')
    } catch (e) {
      setMsg('Marked complete, but OneDrive upload failed: ' + (e as Error).message)
    }
    setBusy(false)
    load()
  }

  const saveCustomValues = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isCompleted) return
    setBusy(true)
    setMsg(null)
    const rows = customFields.map((field) => ({ field_id: field.id, value: customValues[field.id]?.trim() ?? '' }))
    try {
      await api.update('records', record.id, { custom_values: rows })
      setMsg('Record details saved.')
    } catch (e) {
      setMsg((e as Error).message)
    }
    setBusy(false)
    load()
  }

  const download = async () => {
    try {
      const { base64 } = await api.getSignedPdf(record.id)
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${record.signer_name.replace(/\s+/g, '_')}_signed.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(signUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const deleteRecordNow = async () => {
    setBusy(true)
    try {
      await api.remove('records', record.id)
    } catch (e) {
      setBusy(false)
      setMsg((e as Error).message)
      return
    }
    navigate(`/projects/${record.project_id}`)
  }

  const downloadAutoPdf = async () => {
    if (!form?.has_template) return setMsg('Upload a template PDF first.')
    setMsg(null)
    try {
      const { base64 } = await api.getTemplate(form.id)
      const formFields = form.fields
      const values = formFields
        .filter((f) => f.custom_field_id && customValues[f.custom_field_id])
        .map((f) => ({ field_id: f.id, value: customValues[f.custom_field_id!] }))
      const templateBytes = base64ToArrayBuffer(base64)
      const bytes = await buildSignedPdf(templateBytes, formFields, values)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${record.signer_name.replace(/\s+/g, '_')}-${record.id.slice(0, 8)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  return (
    <>
      <PageHeader
        title="Signature record"
        subtitle={form?.name}
        actions={<Link to={`/projects/${record.project_id}`} className="btn-ghost">Back to project</Link>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4 p-6">
          <Row label="Signer" value={record.signer_name} />
          <Row label="Email" value={record.signer_email} />
          <div className="flex items-center justify-between"><span className="text-sm text-cti-gray">Status</span><StatusBadge status={record.status} /></div>
          {record.sent_at && <Row label="Sent" value={new Date(record.sent_at).toLocaleString()} />}
          {record.viewed_at && <Row label="Viewed" value={new Date(record.viewed_at).toLocaleString()} />}
          {record.submitted_at && <Row label="Submitted" value={new Date(record.submitted_at).toLocaleString()} />}
          {record.completed_at && <Row label="Completed" value={new Date(record.completed_at).toLocaleString()} />}
        </div>

        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-heading font-bold text-cti-black">Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" type="button" onClick={() => setShowTimeline((v) => !v)}>Timeline</button>
              {!isAutoPopulate && <a href={signUrl} target="_blank" rel="noreferrer" className="btn-ghost px-3 py-1.5 text-xs">Letter</a>}
              <button className="btn-ghost px-3 py-1.5 text-xs text-cti-red" type="button" onClick={() => setConfirmDelete(true)}>Delete</button>
            </div>
          </div>

          {showTimeline && <Timeline record={record} />}

          {isAutoPopulate ? (
            <button className="btn-primary w-full" onClick={downloadAutoPdf}>Download PDF</button>
          ) : (isCompleted || isSubmitted) ? (
            <>
              <button className="btn-primary w-full" onClick={download}>Download signed PDF</button>
              {isSubmitted && <button className="btn-dark w-full" onClick={markComplete} disabled={busy}>{busy ? 'Saving...' : 'Mark complete'}</button>}
              {record.onedrive_url && <a href={record.onedrive_url} target="_blank" rel="noreferrer" className="btn-ghost w-full">Open copy in OneDrive</a>}
            </>
          ) : (
            <>
              <div>
                <label className="label">Signing link</label>
                <div className="flex gap-2">
                  <input className="input font-mono text-xs" readOnly value={signUrl} />
                  <button className="btn-ghost whitespace-nowrap" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
                </div>
                <p className="mt-1 text-xs text-cti-gray">Paste it into an email to {record.signer_email}.</p>
              </div>
              <button className="btn-primary w-full" onClick={markSent} disabled={busy}>
                {busy ? 'Sending...' : record.status === 'draft' ? 'Send for signature' : 'Send reminder'}
              </button>
            </>
          )}
          {msg && <p className="text-sm text-cti-ink">{msg}</p>}
        </div>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="card w-full max-w-sm space-y-4 p-5">
            <h4 className="font-heading font-bold text-cti-black">Delete this record?</h4>
            <p className="text-sm text-cti-gray">This permanently removes the record and its data. This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn-primary" type="button" onClick={deleteRecordNow} disabled={busy}>{busy ? 'Deleting...' : 'Yes, delete'}</button>
            </div>
          </div>
        </div>
      )}

      <section className="mt-6">
        <form onSubmit={saveCustomValues} className="card space-y-4 p-6">
          <div>
            <h3 className="font-heading font-bold text-cti-black">Record details</h3>
            <p className="mt-1 text-sm text-cti-gray">Project custom field values for this record.</p>
          </div>
          {customFields.length === 0 ? <p className="text-sm text-cti-gray">No project custom fields have been added yet.</p> : (
            <div className="grid gap-4 sm:grid-cols-2">
              {customFields.map((field) => (
                <div key={field.id}>
                  <label className="label">{field.label}{field.required ? ' *' : ''}</label>
                  <RecordCustomInput field={field} disabled={isCompleted || field.type === 'auto_number'} value={customValues[field.id] ?? ''} onChange={(value) => setCustomValues((values) => ({ ...values, [field.id]: value }))} />
                </div>
              ))}
            </div>
          )}
          {customFields.length > 0 && !isCompleted && <button className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save record details'}</button>}
        </form>
      </section>
    </>
  )
}

function RecordCustomInput({ field, disabled, value, onChange }: { field: ProjectCustomField; disabled: boolean; value: string; onChange: (value: string) => void }) {
  const options = normalizeOptions(field.options)
  if (field.type === 'single_dropdown') return <select className="input" required={field.required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  if (field.type === 'multi_dropdown') {
    const selected = parseMultiValue(value)
    return <div className="rounded-md border border-cti-line bg-white p-3"><div className="grid gap-2 sm:grid-cols-2">{options.length === 0 && <p className="text-sm text-cti-gray">No options added.</p>}{options.map((option) => <label key={option} className="flex items-center gap-2 text-sm font-semibold text-cti-ink"><input type="checkbox" disabled={disabled} checked={selected.includes(option)} onChange={(e) => onChange(toggleMultiValue(value, option, e.target.checked))} />{option}</label>)}</div>{field.required && !disabled && !selected.length && <input className="sr-only" required value="" onChange={() => {}} />}</div>
  }
  return <input className="input" type={inputTypeForField(field)} required={field.required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
}

function inputTypeForField(field: ProjectCustomField) {
  if (field.type === 'date') return 'date'
  if (field.type === 'email') return 'email'
  if (field.type === 'number') return 'number'
  return 'text'
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((option) => option.trim()).filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return normalizeOptions(parsed)
    } catch {
      return value.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
    }
    return value.split(/\r?\n|,/).map((option) => option.trim()).filter(Boolean)
  }
  return []
}

function parseMultiValue(value: string | undefined) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

function toggleMultiValue(current: string | undefined, option: string, checked: boolean) {
  const values = new Set(parseMultiValue(current))
  if (checked) values.add(option)
  else values.delete(option)
  return Array.from(values).join(', ')
}

function Timeline({ record }: { record: SignRecord }) {
  const steps = [
    { label: 'Created', at: record.created_at },
    { label: 'Sent', at: record.sent_at },
    { label: 'Viewed', at: record.viewed_at },
    { label: 'Submitted', at: record.submitted_at },
    { label: 'Completed', at: record.completed_at },
  ].filter((step): step is { label: string; at: string } => Boolean(step.at))

  return (
    <div className="rounded-md border border-cti-line bg-cti-bg p-4">
      <ol className="space-y-3 border-l-2 border-cti-line pl-4">
        {steps.map((step) => (
          <li key={step.label} className="relative text-sm">
            <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-cti-red" />
            <p className="font-semibold text-cti-ink">{step.label}</p>
            <p className="text-xs text-cti-gray">{new Date(step.at).toLocaleString()}</p>
          </li>
        ))}
        {steps.length <= 1 && <li className="text-xs text-cti-gray">No further activity yet.</li>}
      </ol>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-cti-gray">{label}</span>
      <span className="text-right text-sm font-semibold text-cti-ink">{value}</span>
    </div>
  )
}

function appBaseUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '')
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
