import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getAppSettings } from '../lib/settings'
import type { CustomFieldType, Form, Project, ProjectCustomField, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'

export function ProjectDetail() {
  const { projectId } = useParams()
  const { session } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [forms, setForms] = useState<Form[]>([])
  const [records, setRecords] = useState<SignRecord[]>([])
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // create-form state
  const [newFormName, setNewFormName] = useState('')
  // create-custom-field state
  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  // create-record state
  const [recFormId, setRecFormId] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [message, setMessage] = useState(() => getAppSettings().defaultSignatureMessage)
  const [customValues, setCustomValues] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    const [{ data: proj }, { data: fms }, { data: recs }, { data: fields, error: fieldsError }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('forms').select('*').eq('project_id', projectId).order('created_at'),
      supabase
        .from('records')
        .select('id, form_id, project_id, signer_name, signer_email, status, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase
        .from('project_custom_fields')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order')
        .order('created_at'),
    ])
    if (fieldsError) setError('Run the updated Supabase schema to enable project custom fields.')
    setProject(proj as Project)
    setForms((fms as Form[]) ?? [])
    setRecords((recs as SignRecord[]) ?? [])
    setCustomFields((fields as ProjectCustomField[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [projectId])

  const createForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFormName.trim()) return
    setError(null)
    const { error } = await supabase
      .from('forms')
      .insert({ project_id: projectId, name: newFormName.trim() })
    if (error) return setError(error.message)
    setNewFormName('')
    load()
  }

  const createCustomField = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFieldLabel.trim()) return
    setError(null)
    const { error } = await supabase.from('project_custom_fields').insert({
      project_id: projectId,
      label: newFieldLabel.trim(),
      type: newFieldType,
      required: newFieldRequired,
      sort_order: customFields.length,
    })
    if (error) return setError(error.message)
    setNewFieldLabel('')
    setNewFieldType('text')
    setNewFieldRequired(false)
    load()
  }

  const deleteCustomField = async (fieldId: string) => {
    setError(null)
    const { error } = await supabase.from('project_custom_fields').delete().eq('id', fieldId)
    if (error) return setError(error.message)
    load()
  }

  const readyForms = forms.filter((f) => f.template_path)
  const missingRequiredCustom = customFields.some((field) => field.required && !customValues[field.id]?.trim())

  const createRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!recFormId || !signerName.trim() || !signerEmail.trim() || missingRequiredCustom) return
    setError(null)
    const { data: record, error } = await supabase
      .from('records')
      .insert({
        form_id: recFormId,
        project_id: projectId,
        signer_name: signerName.trim(),
        signer_email: signerEmail.trim(),
        message: message.trim(),
        created_by: session!.user.id,
      })
      .select('id')
      .single()
    if (error) return setError(error.message)

    const rows = customFields
      .map((field) => ({
        record_id: record.id,
        field_id: field.id,
        value: customValues[field.id]?.trim() ?? '',
      }))
      .filter((row) => row.value)

    if (rows.length) {
      const { error: valuesError } = await supabase.from('record_custom_values').insert(rows)
      if (valuesError) return setError(valuesError.message)
    }

    setSignerName('')
    setSignerEmail('')
    setMessage(getAppSettings().defaultSignatureMessage)
    setCustomValues({})
    setRecFormId('')
    load()
  }

  if (loading) return <p className="text-cti-gray">Loading…</p>
  if (!project) return <p className="text-cti-red">Project not found.</p>

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={project.description || 'Forms, custom fields, and signature records'}
        actions={
          <Link to="/" className="btn-ghost">
            ← All projects
          </Link>
        }
      />

      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Forms */}
        <section>
          <h2 className="mb-3 font-heading font-bold text-cti-black">Forms (templates)</h2>
          <form onSubmit={createForm} className="mb-4 flex gap-2">
            <input
              className="input"
              placeholder="New form name, e.g. NDA 2026"
              value={newFormName}
              onChange={(e) => setNewFormName(e.target.value)}
            />
            <button className="btn-dark whitespace-nowrap">+ Add</button>
          </form>
          <div className="space-y-2">
            {forms.length === 0 && <p className="text-sm text-cti-gray">No forms yet.</p>}
            {forms.map((f) => (
              <div key={f.id} className="card flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold text-cti-ink">{f.name}</p>
                  <p className="text-xs text-cti-gray">
                    {f.template_path ? `Template ready · ${f.page_count} page(s)` : 'No template uploaded'}
                  </p>
                </div>
                <Link to={`/forms/${f.id}/edit`} className="btn-ghost whitespace-nowrap">
                  {f.template_path ? 'Edit mapping' : 'Upload & map'}
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Custom fields */}
        <section>
          <h2 className="mb-3 font-heading font-bold text-cti-black">Project custom fields</h2>
          <form onSubmit={createCustomField} className="card mb-4 space-y-4 p-5">
            <div>
              <label className="label">Field label</label>
              <input
                className="input"
                placeholder="PO number, Department, Contract value..."
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="label">Type</label>
                <select
                  className="input"
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as CustomFieldType)}
                >
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                  <option value="number">Number</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <label className="mt-7 flex items-center gap-2 text-sm font-semibold text-cti-ink">
                <input
                  type="checkbox"
                  checked={newFieldRequired}
                  onChange={(e) => setNewFieldRequired(e.target.checked)}
                />
                Required
              </label>
            </div>
            <button className="btn-dark">+ Add field</button>
          </form>
          <div className="space-y-2">
            {customFields.length === 0 && <p className="text-sm text-cti-gray">No custom fields yet.</p>}
            {customFields.map((field) => (
              <div key={field.id} className="card flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold text-cti-ink">{field.label}</p>
                  <p className="text-xs text-cti-gray">
                    {field.type}{field.required ? ' · required' : ''}
                  </p>
                </div>
                <button className="btn-ghost" type="button" onClick={() => deleteCustomField(field.id)}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* New record */}
      <section className="mt-10">
        <h2 className="mb-3 font-heading font-bold text-cti-black">Send for signature</h2>
        {readyForms.length === 0 ? (
          <div className="card p-4 text-sm text-cti-gray">
            Upload a template and map its fields on a form first, then you can send it for signature.
          </div>
        ) : (
          <form onSubmit={createRecord} className="card space-y-4 p-5">
            <div>
              <label className="label">Form</label>
              <select className="input" value={recFormId} onChange={(e) => setRecFormId(e.target.value)}>
                <option value="">Select a form…</option>
                {readyForms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Signer name</label>
                <input className="input" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
              </div>
              <div>
                <label className="label">Signer email</label>
                <input
                  className="input"
                  type="email"
                  value={signerEmail}
                  onChange={(e) => setSignerEmail(e.target.value)}
                />
              </div>
            </div>
            {customFields.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {customFields.map((field) => (
                  <div key={field.id}>
                    <label className="label">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    <input
                      className="input"
                      type={field.type === 'text' ? 'text' : field.type}
                      required={field.required}
                      value={customValues[field.id] ?? ''}
                      onChange={(e) =>
                        setCustomValues((values) => ({ ...values, [field.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="label">Message (optional)</label>
              <textarea
                className="input"
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Please review and sign the attached document."
              />
            </div>
            <button className="btn-primary">Create record (draft)</button>
          </form>
        )}
      </section>

      {/* Records */}
      <section className="mt-10">
        <h2 className="mb-3 font-heading font-bold text-cti-black">Records</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-cti-line bg-cti-bg text-xs uppercase text-cti-gray">
              <tr>
                <th className="px-4 py-3">Signer</th>
                <th className="px-4 py-3">Form</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-cti-gray">
                    No records yet.
                  </td>
                </tr>
              )}
              {records.map((r) => (
                <tr key={r.id} className="border-b border-cti-line last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-cti-ink">{r.signer_name}</p>
                    <p className="text-xs text-cti-gray">{r.signer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-cti-gray">
                    {forms.find((f) => f.id === r.form_id)?.name ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-cti-gray">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/records/${r.id}`} className="font-semibold text-cti-red hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
