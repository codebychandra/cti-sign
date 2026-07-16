import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getAppSettings } from '../lib/settings'
import type { CustomFieldType, Form, Project, ProjectCustomField, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'

type ProjectTab = 'template' | 'form' | 'completed' | 'setting'

const tabs: { id: ProjectTab; label: string }[] = [
  { id: 'template', label: 'Template' },
  { id: 'form', label: 'Form' },
  { id: 'completed', label: 'Completed' },
  { id: 'setting', label: 'Setting' },
]

export function ProjectDetail() {
  const { projectId } = useParams()
  const { session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseTab(searchParams.get('tab'))
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
        .select('id, form_id, project_id, signer_name, signer_email, status, created_at, signed_pdf_path, onedrive_url, completed_at')
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

  const selectTab = (tab: ProjectTab) => {
    setSearchParams(tab === 'template' ? {} : { tab })
  }

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
  const activeRecords = records.filter((record) => record.status !== 'completed')
  const completedRecords = records.filter((record) => record.status === 'completed')
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
        subtitle={project.description || 'Project workspace'}
        actions={
          <Link to="/" className="btn-ghost">
            ← All projects
          </Link>
        }
      />

      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}

      <div className="mb-6 overflow-x-auto border-b border-cti-line">
        <div className="flex min-w-max gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectTab(tab.id)}
              className={[
                'border-b-2 px-4 py-3 text-left transition-colors',
                activeTab === tab.id
                  ? 'border-cti-red text-cti-black'
                  : 'border-transparent text-cti-gray hover:text-cti-ink',
              ].join(' ')}
            >
              <span className="block text-sm font-bold">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'template' && (
        <TemplateTab forms={forms} newFormName={newFormName} setNewFormName={setNewFormName} createForm={createForm} />
      )}

      {activeTab === 'form' && (
        <FormTab
          readyForms={readyForms}
          forms={forms}
          records={activeRecords}
          recFormId={recFormId}
          setRecFormId={setRecFormId}
          signerName={signerName}
          setSignerName={setSignerName}
          signerEmail={signerEmail}
          setSignerEmail={setSignerEmail}
          message={message}
          setMessage={setMessage}
          customFields={customFields}
          customValues={customValues}
          setCustomValues={setCustomValues}
          createRecord={createRecord}
        />
      )}

      {activeTab === 'completed' && <CompletedTab forms={forms} records={completedRecords} />}

      {activeTab === 'setting' && (
        <SettingTab
          customFields={customFields}
          newFieldLabel={newFieldLabel}
          setNewFieldLabel={setNewFieldLabel}
          newFieldType={newFieldType}
          setNewFieldType={setNewFieldType}
          newFieldRequired={newFieldRequired}
          setNewFieldRequired={setNewFieldRequired}
          createCustomField={createCustomField}
          deleteCustomField={deleteCustomField}
        />
      )}
    </>
  )
}

function TemplateTab({
  forms,
  newFormName,
  setNewFormName,
  createForm,
}: {
  forms: Form[]
  newFormName: string
  setNewFormName: (value: string) => void
  createForm: (e: React.FormEvent) => void
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-bold text-cti-black">Templates</h2>
        <p className="mt-1 text-sm text-cti-gray">Create template records, upload PDFs, and map signing fields.</p>
      </div>
      <form onSubmit={createForm} className="card flex flex-col gap-3 p-4 sm:flex-row">
        <input
          className="input"
          placeholder="New template name, e.g. NDA 2026"
          value={newFormName}
          onChange={(e) => setNewFormName(e.target.value)}
        />
        <button className="btn-dark whitespace-nowrap">+ Add template</button>
      </form>
      <div className="grid gap-3 lg:grid-cols-2">
        {forms.length === 0 && <EmptyState text="No templates yet. Add one to upload and map a PDF." />}
        {forms.map((form) => (
          <div key={form.id} className="card flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold text-cti-ink">{form.name}</p>
              <p className="text-xs text-cti-gray">
                {form.template_path ? `Template ready · ${form.page_count} page(s)` : 'No template uploaded'}
              </p>
            </div>
            <Link to={`/forms/${form.id}/edit`} className="btn-ghost whitespace-nowrap">
              {form.template_path ? 'Edit mapping' : 'Upload & map'}
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

function FormTab({
  readyForms,
  forms,
  records,
  recFormId,
  setRecFormId,
  signerName,
  setSignerName,
  signerEmail,
  setSignerEmail,
  message,
  setMessage,
  customFields,
  customValues,
  setCustomValues,
  createRecord,
}: {
  readyForms: Form[]
  forms: Form[]
  records: SignRecord[]
  recFormId: string
  setRecFormId: (value: string) => void
  signerName: string
  setSignerName: (value: string) => void
  signerEmail: string
  setSignerEmail: (value: string) => void
  message: string
  setMessage: (value: string) => void
  customFields: ProjectCustomField[]
  customValues: Record<string, string>
  setCustomValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  createRecord: (e: React.FormEvent) => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
      <section>
        <h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Add record and send signature</h2>
        {readyForms.length === 0 ? (
          <EmptyState text="Upload and map a template before creating signature records." />
        ) : (
          <form onSubmit={createRecord} className="card space-y-4 p-5">
            <div>
              <label className="label">Template</label>
              <select className="input" value={recFormId} onChange={(e) => setRecFormId(e.target.value)}>
                <option value="">Select a template…</option>
                {readyForms.map((form) => (
                  <option key={form.id} value={form.id}>
                    {form.name}
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
                <input className="input" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
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
                      onChange={(e) => setCustomValues((values) => ({ ...values, [field.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            )}
            <div>
              <label className="label">Message</label>
              <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>
            <button className="btn-primary">Create record</button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Active records</h2>
        <RecordsTable forms={forms} records={records} empty="No active records." />
      </section>
    </div>
  )
}

function CompletedTab({ forms, records }: { forms: Form[]; records: SignRecord[] }) {
  return (
    <section>
      <h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Completed signed documents</h2>
      <RecordsTable forms={forms} records={records} empty="No completed signed documents yet." showCompleted />
    </section>
  )
}

function SettingTab({
  customFields,
  newFieldLabel,
  setNewFieldLabel,
  newFieldType,
  setNewFieldType,
  newFieldRequired,
  setNewFieldRequired,
  createCustomField,
  deleteCustomField,
}: {
  customFields: ProjectCustomField[]
  newFieldLabel: string
  setNewFieldLabel: (value: string) => void
  newFieldType: CustomFieldType
  setNewFieldType: (value: CustomFieldType) => void
  newFieldRequired: boolean
  setNewFieldRequired: (value: boolean) => void
  createCustomField: (e: React.FormEvent) => void
  deleteCustomField: (fieldId: string) => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Custom fields</h2>
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
              <select className="input" value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as CustomFieldType)}>
                <option value="text">Text</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
                <option value="email">Email</option>
              </select>
            </div>
            <label className="mt-7 flex items-center gap-2 text-sm font-semibold text-cti-ink">
              <input type="checkbox" checked={newFieldRequired} onChange={(e) => setNewFieldRequired(e.target.checked)} />
              Required
            </label>
          </div>
          <button className="btn-dark">+ Add field</button>
        </form>
        <div className="space-y-2">
          {customFields.length === 0 && <EmptyState text="No custom fields yet." />}
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

      <aside className="space-y-4">
        <section className="card p-5">
          <h2 className="font-heading text-base font-bold text-cti-black">Email setting</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <SettingRow label="Provider" value="Microsoft Graph" />
            <SettingRow label="Sender" value="cti-it-team@cti-usa.com" />
            <SettingRow label="Function" value="send-signature-request" />
          </dl>
        </section>
        <section className="card p-5 text-sm text-cti-gray">
          <h2 className="font-heading text-base font-bold text-cti-black">Secrets</h2>
          <p className="mt-3">Mail credentials are stored in Supabase Edge Function secrets, not in the browser app.</p>
        </section>
      </aside>
    </div>
  )
}

function RecordsTable({
  forms,
  records,
  empty,
  showCompleted = false,
}: {
  forms: Form[]
  records: SignRecord[]
  empty: string
  showCompleted?: boolean
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-cti-line bg-cti-bg text-xs uppercase text-cti-gray">
          <tr>
            <th className="px-4 py-3">Signer</th>
            <th className="px-4 py-3">Template</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">{showCompleted ? 'Completed' : 'Created'}</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-cti-gray">
                {empty}
              </td>
            </tr>
          )}
          {records.map((record) => (
            <tr key={record.id} className="border-b border-cti-line last:border-0">
              <td className="px-4 py-3">
                <p className="font-semibold text-cti-ink">{record.signer_name}</p>
                <p className="text-xs text-cti-gray">{record.signer_email}</p>
              </td>
              <td className="px-4 py-3 text-cti-gray">{forms.find((form) => form.id === record.form_id)?.name ?? '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge status={record.status} />
              </td>
              <td className="px-4 py-3 text-cti-gray">
                {new Date((showCompleted && record.completed_at) || record.created_at).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <Link to={`/records/${record.id}`} className="font-semibold text-cti-red hover:underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="card p-6 text-center text-sm text-cti-gray">{text}</div>
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase text-cti-gray">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-cti-ink">{value}</dd>
    </div>
  )
}

function parseTab(value: string | null): ProjectTab {
  return tabs.some((tab) => tab.id === value) ? (value as ProjectTab) : 'template'
}
