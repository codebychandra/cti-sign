import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getAppSettings } from '../lib/settings'
import type { CustomFieldType, Form, Project, ProjectCustomField, RecordCustomValue, SignRecord } from '../lib/types'
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
  const [recordValues, setRecordValues] = useState<Record<string, Record<string, string>>>({})
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editFieldLabel, setEditFieldLabel] = useState('')
  const [editFieldType, setEditFieldType] = useState<CustomFieldType>('text')
  const [editFieldRequired, setEditFieldRequired] = useState(false)

  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [message, setMessage] = useState(() => getAppSettings().defaultSignatureMessage)
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [importText, setImportText] = useState('')
  const [selectedRecords, setSelectedRecords] = useState<Record<string, boolean>>({})

  const load = async () => {
    setLoading(true)
    setError(null)
    const [{ data: proj }, { data: fms }, { data: recs }, { data: fields, error: fieldsError }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('forms').select('*').eq('project_id', projectId).order('created_at'),
      supabase
        .from('records')
        .select('id, form_id, project_id, signer_name, signer_email, status, created_at, signed_pdf_path, signed_pdf_data, onedrive_url, sent_at, viewed_at, submitted_at, completed_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false }),
      supabase.from('project_custom_fields').select('*').eq('project_id', projectId).order('sort_order').order('created_at'),
    ])
    if (fieldsError) setError('Run the updated Supabase schema to enable project custom fields.')
    const loadedRecords = (recs as SignRecord[]) ?? []
    setProject({ ...(proj as Project), project_type: (proj as Project)?.project_type ?? 'sent_signature' })
    setForms((fms as Form[]) ?? [])
    setRecords(loadedRecords)
    setCustomFields((fields as ProjectCustomField[]) ?? [])
    if (loadedRecords.length) {
      const { data: values } = await supabase.from('record_custom_values').select('*').in('record_id', loadedRecords.map((record) => record.id))
      setRecordValues(groupRecordValues((values as RecordCustomValue[]) ?? []))
    } else {
      setRecordValues({})
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [projectId])

  const template = forms[0]
  const isAutoPopulate = project?.project_type === 'auto_populate'
  const activeRecords = records.filter((record) => record.status !== 'completed')
  const completedRecords = records.filter((record) => record.status === 'completed')
  const missingRequiredCustom = customFields.some((field) => field.required && !customValues[field.id]?.trim())

  const ensureTemplate = async () => {
    if (template || !projectId) return
    const { error } = await supabase.from('forms').insert({ project_id: projectId, name: 'Template' })
    if (error) return setError(error.message)
    load()
  }

  const createCustomField = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFieldLabel.trim()) return
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

  const beginEditField = (field: ProjectCustomField) => {
    setEditingFieldId(field.id)
    setEditFieldLabel(field.label)
    setEditFieldType(field.type)
    setEditFieldRequired(field.required)
  }

  const saveFieldEdit = async (fieldId: string) => {
    if (!editFieldLabel.trim()) return
    const { error } = await supabase.from('project_custom_fields').update({ label: editFieldLabel.trim(), type: editFieldType, required: editFieldRequired }).eq('id', fieldId)
    if (error) return setError(error.message)
    setEditingFieldId(null)
    load()
  }

  const deleteCustomField = async (fieldId: string) => {
    const { error } = await supabase.from('project_custom_fields').delete().eq('id', fieldId)
    if (error) return setError(error.message)
    load()
  }

  const moveCustomField = async (fieldId: string, direction: -1 | 1) => {
    const index = customFields.findIndex((field) => field.id === fieldId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= customFields.length) return
    const next = [...customFields]
    const [moved] = next.splice(index, 1)
    next.splice(targetIndex, 0, moved)
    setCustomFields(next.map((field, i) => ({ ...field, sort_order: i })))
    await Promise.all(next.map((field, i) => supabase.from('project_custom_fields').update({ sort_order: i }).eq('id', field.id)))
    load()
  }

  const saveValuesForRecord = async (recordId: string, values: Record<string, string>) => {
    const rows = customFields.map((field) => ({ record_id: recordId, field_id: field.id, value: values[field.id]?.trim() ?? '' })).filter((row) => row.value)
    if (rows.length) await supabase.from('record_custom_values').upsert(rows, { onConflict: 'record_id,field_id' })
  }

  const createRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!template || !template.template_path || missingRequiredCustom) return
    if (!isAutoPopulate && (!signerName.trim() || !signerEmail.trim())) return
    const { data: record, error } = await supabase.from('records').insert({
      form_id: template.id,
      project_id: projectId,
      signer_name: isAutoPopulate ? 'Auto populate record' : signerName.trim(),
      signer_email: isAutoPopulate ? 'no-reply@cti.local' : signerEmail.trim(),
      message: isAutoPopulate ? '' : message.trim(),
      created_by: session!.user.id,
    }).select('id').single()
    if (error) return setError(error.message)
    await saveValuesForRecord(record.id, customValues)
    setSignerName('')
    setSignerEmail('')
    setMessage(getAppSettings().defaultSignatureMessage)
    setCustomValues({})
    load()
  }

  const importRecords = async () => {
    if (!template || !template.template_path || !importText.trim()) return
    const rows = parseCsv(importText)
    if (!rows.length) return setError('No import rows found.')
    for (const row of rows) {
      const { data: record, error } = await supabase.from('records').insert({
        form_id: template.id,
        project_id: projectId,
        signer_name: isAutoPopulate ? 'Auto populate record' : row.signer_name || row.name || '',
        signer_email: isAutoPopulate ? 'no-reply@cti.local' : row.signer_email || row.email || '',
        message: isAutoPopulate ? '' : message.trim(),
        created_by: session!.user.id,
      }).select('id').single()
      if (error) return setError(error.message)
      const values: Record<string, string> = {}
      for (const field of customFields) values[field.id] = row[field.label] ?? row[field.label.toLowerCase()] ?? ''
      await saveValuesForRecord(record.id, values)
    }
    setImportText('')
    load()
  }

  const massMarkSent = async () => {
    const ids = Object.entries(selectedRecords).filter(([, selected]) => selected).map(([id]) => id)
    if (!ids.length) return
    await supabase.from('records').update({ status: 'sent', sent_at: new Date().toISOString() }).in('id', ids)
    setSelectedRecords({})
    load()
  }

  const deleteRecord = async (recordId: string) => {
    await supabase.from('records').delete().eq('id', recordId)
    load()
  }

  const markComplete = async (recordId: string) => {
    await supabase.from('records').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', recordId)
    load()
  }

  if (loading) return <p className="text-cti-gray">Loading…</p>
  if (!project) return <p className="text-cti-red">Project not found.</p>

  return (
    <>
      <PageHeader title={project.name} subtitle={isAutoPopulate ? 'Auto-populate PDF workflow' : 'Signature request workflow'} actions={<Link to="/" className="btn-ghost">← All projects</Link>} />
      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}
      <div className="mb-6 overflow-x-auto border-b border-cti-line">
        <div className="flex min-w-max gap-2">
          {tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setSearchParams(tab.id === 'template' ? {} : { tab: tab.id })} className={`border-b-2 px-4 py-3 text-left transition-colors ${activeTab === tab.id ? 'border-cti-red text-cti-black' : 'border-transparent text-cti-gray hover:text-cti-ink'}`}><span className="block text-sm font-bold">{tab.label}</span></button>)}
        </div>
      </div>

      {activeTab === 'template' && <TemplateTab template={template} customFields={customFields} newFieldLabel={newFieldLabel} setNewFieldLabel={setNewFieldLabel} newFieldType={newFieldType} setNewFieldType={setNewFieldType} newFieldRequired={newFieldRequired} setNewFieldRequired={setNewFieldRequired} editingFieldId={editingFieldId} editFieldLabel={editFieldLabel} setEditFieldLabel={setEditFieldLabel} editFieldType={editFieldType} setEditFieldType={setEditFieldType} editFieldRequired={editFieldRequired} setEditFieldRequired={setEditFieldRequired} createCustomField={createCustomField} beginEditField={beginEditField} saveFieldEdit={saveFieldEdit} cancelFieldEdit={() => setEditingFieldId(null)} deleteCustomField={deleteCustomField} moveCustomField={moveCustomField} ensureTemplate={ensureTemplate} />}
      {activeTab === 'form' && <FormTab isAutoPopulate={isAutoPopulate} template={template} records={activeRecords} customFields={customFields} recordValues={recordValues} signerName={signerName} setSignerName={setSignerName} signerEmail={signerEmail} setSignerEmail={setSignerEmail} message={message} setMessage={setMessage} customValues={customValues} setCustomValues={setCustomValues} createRecord={createRecord} importText={importText} setImportText={setImportText} importRecords={importRecords} selectedRecords={selectedRecords} setSelectedRecords={setSelectedRecords} massMarkSent={massMarkSent} deleteRecord={deleteRecord} markComplete={markComplete} />}
      {activeTab === 'completed' && <CompletedTab records={completedRecords} customFields={customFields} recordValues={recordValues} />}
      {activeTab === 'setting' && <SettingTab project={project} />}
    </>
  )
}

function TemplateTab(props: {
  template?: Form
  customFields: ProjectCustomField[]
  newFieldLabel: string
  setNewFieldLabel: (value: string) => void
  newFieldType: CustomFieldType
  setNewFieldType: (value: CustomFieldType) => void
  newFieldRequired: boolean
  setNewFieldRequired: (value: boolean) => void
  editingFieldId: string | null
  editFieldLabel: string
  setEditFieldLabel: (value: string) => void
  editFieldType: CustomFieldType
  setEditFieldType: (value: CustomFieldType) => void
  editFieldRequired: boolean
  setEditFieldRequired: (value: boolean) => void
  createCustomField: (e: React.FormEvent) => void
  beginEditField: (field: ProjectCustomField) => void
  saveFieldEdit: (fieldId: string) => void
  cancelFieldEdit: () => void
  deleteCustomField: (fieldId: string) => void
  moveCustomField: (fieldId: string, direction: -1 | 1) => void
  ensureTemplate: () => void
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="space-y-4">
        <div><h2 className="font-heading text-lg font-bold text-cti-black">Template setup</h2><p className="mt-1 text-sm text-cti-gray">Create record columns, then map those fields onto the template PDF.</p></div>
        <div className="card flex items-center justify-between gap-3 p-4">
          <div><p className="font-semibold text-cti-ink">{props.template?.name ?? 'Template'}</p><p className="text-sm text-cti-gray">{props.template?.template_path ? `Template ready · ${props.template.page_count} page(s)` : 'No PDF uploaded yet'}</p></div>
          {props.template ? <Link to={`/forms/${props.template.id}/edit`} className="btn-primary whitespace-nowrap">Upload & map PDF</Link> : <button className="btn-primary" onClick={props.ensureTemplate}>Create template</button>}
        </div>
      </section>
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-bold text-cti-black">Record columns</h2>
        <form onSubmit={props.createCustomField} className="card space-y-4 p-5">
          <div><label className="label">Field label</label><input className="input" value={props.newFieldLabel} onChange={(e) => props.setNewFieldLabel(e.target.value)} /></div>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]"><div><label className="label">Type</label><FieldTypeSelect value={props.newFieldType} onChange={props.setNewFieldType} /></div><label className="mt-7 flex items-center gap-2 text-sm font-semibold text-cti-ink"><input type="checkbox" checked={props.newFieldRequired} onChange={(e) => props.setNewFieldRequired(e.target.checked)} />Required</label></div>
          <button className="btn-dark">+ Add field</button>
        </form>
        <div className="space-y-2">
          {props.customFields.length === 0 && <EmptyState text="No custom fields yet." />}
          {props.customFields.map((field, index) => <FieldRow key={field.id} field={field} index={index} total={props.customFields.length} {...props} />)}
        </div>
      </section>
    </div>
  )
}

function FieldRow(props: any) {
  const field = props.field as ProjectCustomField
  if (props.editingFieldId === field.id) {
    return <div className="card space-y-3 p-4"><input className="input" value={props.editFieldLabel} onChange={(e) => props.setEditFieldLabel(e.target.value)} /><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><FieldTypeSelect value={props.editFieldType} onChange={props.setEditFieldType} /><label className="flex items-center gap-2 text-sm font-semibold text-cti-ink"><input type="checkbox" checked={props.editFieldRequired} onChange={(e) => props.setEditFieldRequired(e.target.checked)} />Required</label></div><div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => props.saveFieldEdit(field.id)}>Save</button><button type="button" className="btn-ghost" onClick={props.cancelFieldEdit}>Cancel</button></div></div>
  }
  return <div className="card flex items-center justify-between gap-3 p-4"><div><p className="font-semibold text-cti-ink">{field.label}</p><p className="text-xs text-cti-gray">{field.type}{field.required ? ' · required' : ''}</p></div><div className="flex flex-wrap justify-end gap-2"><button className="btn-ghost px-2 py-1 text-xs" type="button" disabled={props.index === 0} onClick={() => props.moveCustomField(field.id, -1)}>↑</button><button className="btn-ghost px-2 py-1 text-xs" type="button" disabled={props.index === props.total - 1} onClick={() => props.moveCustomField(field.id, 1)}>↓</button><button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={() => props.beginEditField(field)}>Edit</button><button className="btn-ghost px-2 py-1 text-xs text-cti-red" type="button" onClick={() => props.deleteCustomField(field.id)}>Delete</button></div></div>
}

function FormTab(props: any) {
  const hasTemplate = Boolean(props.template?.template_path)
  return <div className="space-y-6"><div className="grid gap-6 xl:grid-cols-[420px_1fr]"><section><h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Add record</h2>{!hasTemplate && <EmptyState text="Create and map one template before adding records." />}<form onSubmit={props.createRecord} className="card space-y-4 p-5"><div><label className="label">Template</label><input className="input" readOnly value={props.template?.name ?? 'Template not ready'} /></div>{!props.isAutoPopulate && <div className="grid gap-4 sm:grid-cols-2"><div><label className="label">Signer name</label><input className="input" value={props.signerName} onChange={(e) => props.setSignerName(e.target.value)} /></div><div><label className="label">Signer email</label><input className="input" type="email" value={props.signerEmail} onChange={(e) => props.setSignerEmail(e.target.value)} /></div></div>}<CustomValueInputs fields={props.customFields} values={props.customValues} setValues={props.setCustomValues} />{!props.isAutoPopulate && <div><label className="label">Message</label><textarea className="input" rows={3} value={props.message} onChange={(e) => props.setMessage(e.target.value)} /></div>}<button className="btn-primary" disabled={!hasTemplate}>Create record</button></form></section><section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-lg font-bold text-cti-black">Records</h2>{!props.isAutoPopulate && <button className="btn-primary" onClick={props.massMarkSent}>Mass send selected</button>}</div><RecordsTable {...props} completed={false} /></section></div><section className="card space-y-3 p-5"><h2 className="font-heading text-lg font-bold text-cti-black">Import records</h2><p className="text-sm text-cti-gray">Paste CSV with headers matching your field labels. For signature projects, include signer_name and signer_email.</p><textarea className="input font-mono text-xs" rows={5} value={props.importText} onChange={(e) => props.setImportText(e.target.value)} /><button className="btn-dark" onClick={props.importRecords} disabled={!hasTemplate}>Import CSV</button></section></div>
}

function CompletedTab({ records, customFields, recordValues }: { records: SignRecord[]; customFields: ProjectCustomField[]; recordValues: Record<string, Record<string, string>> }) {
  return <section><h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Completed signed documents</h2><RecordsTable isAutoPopulate={false} records={records} customFields={customFields} recordValues={recordValues} selectedRecords={{}} setSelectedRecords={() => {}} deleteRecord={() => {}} markComplete={() => {}} completed /></section>
}

function SettingTab({ project }: { project: Project }) {
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"><section className="card p-5"><h2 className="font-heading text-base font-bold text-cti-black">Workflow</h2><dl className="mt-4 space-y-3 text-sm"><SettingRow label="Project type" value={project.project_type === 'auto_populate' ? 'Auto populate' : 'Sent signature'} /><SettingRow label="Template rule" value="One template per project" /></dl></section><aside className="space-y-4"><section className="card p-5"><h2 className="font-heading text-base font-bold text-cti-black">Email setting</h2><dl className="mt-4 space-y-3 text-sm"><SettingRow label="Provider" value="Microsoft Graph" /><SettingRow label="Sender" value="cti-it-team@cti-usa.com" /><SettingRow label="Function" value="send-signature-request" /></dl></section></aside></div>
}

function RecordsTable(props: { isAutoPopulate: boolean; records: SignRecord[]; customFields: ProjectCustomField[]; recordValues: Record<string, Record<string, string>>; selectedRecords: Record<string, boolean>; setSelectedRecords: React.Dispatch<React.SetStateAction<Record<string, boolean>>> | (() => void); deleteRecord: (recordId: string) => void; markComplete: (recordId: string) => void; completed: boolean }) {
  return <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-cti-line bg-cti-bg text-xs uppercase text-cti-gray"><tr>{!props.completed && !props.isAutoPopulate && <th className="px-4 py-3"></th>}<th className="px-4 py-3">Created</th>{!props.isAutoPopulate && <th className="px-4 py-3">Signer</th>}<th className="px-4 py-3">Status</th>{props.customFields.map((field) => <th key={field.id} className="px-4 py-3">{field.label}</th>)}<th className="px-4 py-3"></th></tr></thead><tbody>{props.records.length === 0 && <tr><td colSpan={props.customFields.length + 5} className="px-4 py-6 text-center text-cti-gray">No records.</td></tr>}{props.records.map((record) => <tr key={record.id} className="border-b border-cti-line last:border-0">{!props.completed && !props.isAutoPopulate && <td className="px-4 py-3"><input type="checkbox" checked={Boolean(props.selectedRecords[record.id])} onChange={(e) => typeof props.setSelectedRecords === 'function' && (props.setSelectedRecords as React.Dispatch<React.SetStateAction<Record<string, boolean>>>)((state) => ({ ...state, [record.id]: e.target.checked }))} /></td>}<td className="px-4 py-3 text-cti-gray">{new Date(record.created_at).toLocaleDateString()}</td>{!props.isAutoPopulate && <td className="px-4 py-3"><p className="font-semibold text-cti-ink">{record.signer_name}</p><p className="text-xs text-cti-gray">{record.signer_email}</p></td>}<td className="px-4 py-3"><StatusBadge status={record.status} /></td>{props.customFields.map((field) => <td key={field.id} className="px-4 py-3 text-cti-gray">{props.recordValues[record.id]?.[field.id] ?? ''}</td>)}<td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Link to={`/records/${record.id}`} className="font-semibold text-cti-red hover:underline">{props.completed ? 'View' : 'Edit'}</Link>{!props.completed && record.status === 'submitted' && <button className="font-semibold text-green-700 hover:underline" onClick={() => props.markComplete(record.id)}>Complete</button>}{!props.completed && <button className="font-semibold text-cti-gray hover:underline" onClick={() => props.deleteRecord(record.id)}>Delete</button>}</div></td></tr>)}</tbody></table></div>
}

function CustomValueInputs({ fields, values, setValues }: { fields: ProjectCustomField[]; values: Record<string, string>; setValues: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  if (!fields.length) return <p className="text-sm text-cti-gray">No custom fields yet. Add columns in the Template tab.</p>
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map((field) => <div key={field.id}><label className="label">{field.label}{field.required ? ' *' : ''}</label><input className="input" type={field.type === 'text' ? 'text' : field.type} required={field.required} value={values[field.id] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [field.id]: e.target.value }))} /></div>)}</div>
}

function FieldTypeSelect({ value, onChange }: { value: CustomFieldType; onChange: (value: CustomFieldType) => void }) {
  return <select className="input" value={value} onChange={(e) => onChange(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="date">Date</option><option value="number">Number</option><option value="email">Email</option></select>
}

function groupRecordValues(values: RecordCustomValue[]) {
  return values.reduce<Record<string, Record<string, string>>>((acc, value) => {
    if (!acc[value.record_id]) acc[value.record_id] = {}
    acc[value.record_id][value.field_id] = value.value ?? ''
    return acc
  }, {})
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((header) => header.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((cell) => cell.trim())
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = cells[index] ?? ''
      row[header.toLowerCase()] = cells[index] ?? ''
      return row
    }, {})
  })
}

function EmptyState({ text }: { text: string }) {
  return <div className="card p-6 text-center text-sm text-cti-gray">{text}</div>
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs uppercase text-cti-gray">{label}</dt><dd className="mt-1 break-words font-semibold text-cti-ink">{value}</dd></div>
}

function parseTab(value: string | null): ProjectTab {
  return tabs.some((tab) => tab.id === value) ? (value as ProjectTab) : 'template'
}
