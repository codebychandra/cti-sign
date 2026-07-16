import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { getAppSettings } from '../lib/settings'
import type { CustomFieldType, Form, Project, ProjectCustomField, RecordCustomValue, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'

type ProjectTab = 'template' | 'form' | 'completed' | 'setting'
type PanelMode = 'add' | 'import' | null

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
  const [panel, setPanel] = useState<PanelMode>(null)

  const [newFieldLabel, setNewFieldLabel] = useState('')
  const [newFieldType, setNewFieldType] = useState<CustomFieldType>('text')
  const [newFieldRequired, setNewFieldRequired] = useState(false)
  const [newFieldShow, setNewFieldShow] = useState(true)
  const [newFieldPrefix, setNewFieldPrefix] = useState('')
  const [newFieldStart, setNewFieldStart] = useState(1)
  const [newFieldOptions, setNewFieldOptions] = useState('')
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editFieldLabel, setEditFieldLabel] = useState('')
  const [editFieldType, setEditFieldType] = useState<CustomFieldType>('text')
  const [editFieldRequired, setEditFieldRequired] = useState(false)
  const [editFieldShow, setEditFieldShow] = useState(true)
  const [editFieldPrefix, setEditFieldPrefix] = useState('')
  const [editFieldStart, setEditFieldStart] = useState(1)
  const [editFieldOptions, setEditFieldOptions] = useState('')

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
    setCustomFields(((fields as ProjectCustomField[]) ?? []).map((field) => ({ ...field, show_in_table: field.show_in_table ?? true, auto_prefix: field.auto_prefix ?? '', auto_start: field.auto_start ?? 1, options: normalizeOptions(field.options) })))
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
  const visibleFields = customFields.filter((field) => field.show_in_table)
  const activeRecords = records.filter((record) => record.status !== 'completed')
  const completedRecords = records.filter((record) => record.status === 'completed')
  const missingRequiredCustom = customFields.some((field) => field.type !== 'auto_number' && field.required && !customValues[field.id]?.trim())

  const ensureTemplate = async () => {
    if (template || !projectId) return
    const { error } = await supabase.from('forms').insert({ project_id: projectId, name: 'Template' })
    if (error) return setError(error.message)
    load()
  }

  const renameTemplate = async (templateId: string, name: string) => {
    const cleanName = name.trim()
    if (!cleanName) return
    const { error } = await supabase.from('forms').update({ name: cleanName }).eq('id', templateId)
    if (error) return setError(error.message)
    load()
  }

  const deleteTemplate = async (templateId: string) => {
    if (!window.confirm('Delete this template and its mapped fields?')) return
    const { error } = await supabase.from('forms').delete().eq('id', templateId)
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
      show_in_table: newFieldShow,
      auto_prefix: newFieldType === 'auto_number' ? newFieldPrefix.trim() : null,
      auto_start: newFieldType === 'auto_number' ? Number(newFieldStart) || 1 : 1,
      options: isDropdownType(newFieldType) ? optionTextToList(newFieldOptions) : [],
      sort_order: customFields.length,
    })
    if (error) return setError(error.message)
    setNewFieldLabel('')
    setNewFieldType('text')
    setNewFieldRequired(false)
    setNewFieldShow(true)
    setNewFieldPrefix('')
    setNewFieldStart(1)
    setNewFieldOptions('')
    load()
  }

  const beginEditField = (field: ProjectCustomField) => {
    setEditingFieldId(field.id)
    setEditFieldLabel(field.label)
    setEditFieldType(field.type)
    setEditFieldRequired(field.required)
    setEditFieldShow(field.show_in_table)
    setEditFieldPrefix(field.auto_prefix ?? '')
    setEditFieldStart(field.auto_start ?? 1)
    setEditFieldOptions(normalizeOptions(field.options).join('\n'))
  }

  const saveFieldEdit = async (fieldId: string) => {
    if (!editFieldLabel.trim()) return
    const { error } = await supabase.from('project_custom_fields').update({
      label: editFieldLabel.trim(),
      type: editFieldType,
      required: editFieldRequired,
      show_in_table: editFieldShow,
      auto_prefix: editFieldType === 'auto_number' ? editFieldPrefix.trim() : null,
      auto_start: editFieldType === 'auto_number' ? Number(editFieldStart) || 1 : 1,
      options: isDropdownType(editFieldType) ? optionTextToList(editFieldOptions) : [],
    }).eq('id', fieldId)
    if (error) return setError(error.message)
    setEditingFieldId(null)
    load()
  }

  const deleteCustomField = async (fieldId: string) => {
    const { error } = await supabase.from('project_custom_fields').delete().eq('id', fieldId)
    if (error) return setError(error.message)
    load()
  }

  const toggleFieldVisible = async (field: ProjectCustomField) => {
    await supabase.from('project_custom_fields').update({ show_in_table: !field.show_in_table }).eq('id', field.id)
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

  const withAutoNumbers = (values: Record<string, string>, offset = 0) => {
    const next = { ...values }
    for (const field of customFields) {
      if (field.type !== 'auto_number' || next[field.id]?.trim()) continue
      next[field.id] = `${field.auto_prefix ?? ''}${(field.auto_start ?? 1) + records.length + offset}`
    }
    return next
  }

  const saveValuesForRecord = async (recordId: string, values: Record<string, string>) => {
    const rows = customFields.map((field) => ({ record_id: recordId, field_id: field.id, value: values[field.id]?.trim() ?? '' })).filter((row) => row.value)
    if (rows.length) await supabase.from('record_custom_values').upsert(rows, { onConflict: 'record_id,field_id' })
  }

  const createRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!template || !template.template_path || missingRequiredCustom) return
    if (!isAutoPopulate && (!signerName.trim() || !signerEmail.trim())) return
    const values = withAutoNumbers(customValues)
    const { data: record, error } = await supabase.from('records').insert({ form_id: template.id, project_id: projectId, signer_name: isAutoPopulate ? 'Auto populate record' : signerName.trim(), signer_email: isAutoPopulate ? 'no-reply@cti.local' : signerEmail.trim(), message: isAutoPopulate ? '' : message.trim(), created_by: session!.user.id }).select('id').single()
    if (error) return setError(error.message)
    await saveValuesForRecord(record.id, values)
    setSignerName('')
    setSignerEmail('')
    setMessage(getAppSettings().defaultSignatureMessage)
    setCustomValues({})
    setPanel(null)
    load()
  }

  const importRecords = async () => {
    if (!template || !template.template_path || !importText.trim()) return
    const rows = parseCsv(importText)
    if (!rows.length) return setError('No import rows found.')
    for (const [index, row] of rows.entries()) {
      const { data: record, error } = await supabase.from('records').insert({ form_id: template.id, project_id: projectId, signer_name: isAutoPopulate ? 'Auto populate record' : row.signer_name || row.name || '', signer_email: isAutoPopulate ? 'no-reply@cti.local' : row.signer_email || row.email || '', message: isAutoPopulate ? '' : message.trim(), created_by: session!.user.id }).select('id').single()
      if (error) return setError(error.message)
      const values: Record<string, string> = {}
      for (const field of customFields) values[field.id] = row[field.label] ?? row[field.label.toLowerCase()] ?? ''
      await saveValuesForRecord(record.id, withAutoNumbers(values, index))
    }
    setImportText('')
    setPanel(null)
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

  if (loading) return <p className="text-cti-gray">Loading...</p>
  if (!project) return <p className="text-cti-red">Project not found.</p>

  return (
    <>
      <PageHeader title={project.name} subtitle={isAutoPopulate ? 'Auto-populate PDF workflow' : 'Signature request workflow'} actions={<Link to="/" className="btn-ghost">All projects</Link>} />
      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}
      <div className="mb-6 overflow-x-auto border-b border-cti-line"><div className="flex min-w-max gap-2">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setSearchParams(tab.id === 'template' ? {} : { tab: tab.id })} className={`border-b-2 px-4 py-3 text-left transition-colors ${activeTab === tab.id ? 'border-cti-red text-cti-black' : 'border-transparent text-cti-gray hover:text-cti-ink'}`}><span className="block text-sm font-bold">{tab.label}</span></button>)}</div></div>
      {activeTab === 'template' && <TemplateTab template={template} customFields={customFields} ensureTemplate={ensureTemplate} renameTemplate={renameTemplate} deleteTemplate={deleteTemplate} />}
      {activeTab === 'form' && <FormTab isAutoPopulate={isAutoPopulate} template={template} records={activeRecords} visibleFields={visibleFields} recordValues={recordValues} selectedRecords={selectedRecords} setSelectedRecords={setSelectedRecords} massMarkSent={massMarkSent} deleteRecord={deleteRecord} markComplete={markComplete} openPanel={setPanel} />}
      {activeTab === 'completed' && <CompletedTab isAutoPopulate={isAutoPopulate} records={completedRecords} visibleFields={visibleFields} recordValues={recordValues} />}
      {activeTab === 'setting' && <SettingTab customFields={customFields} newFieldLabel={newFieldLabel} setNewFieldLabel={setNewFieldLabel} newFieldType={newFieldType} setNewFieldType={setNewFieldType} newFieldRequired={newFieldRequired} setNewFieldRequired={setNewFieldRequired} newFieldShow={newFieldShow} setNewFieldShow={setNewFieldShow} newFieldPrefix={newFieldPrefix} setNewFieldPrefix={setNewFieldPrefix} newFieldStart={newFieldStart} setNewFieldStart={setNewFieldStart} newFieldOptions={newFieldOptions} setNewFieldOptions={setNewFieldOptions} editingFieldId={editingFieldId} editFieldLabel={editFieldLabel} setEditFieldLabel={setEditFieldLabel} editFieldType={editFieldType} setEditFieldType={setEditFieldType} editFieldRequired={editFieldRequired} setEditFieldRequired={setEditFieldRequired} editFieldShow={editFieldShow} setEditFieldShow={setEditFieldShow} editFieldPrefix={editFieldPrefix} setEditFieldPrefix={setEditFieldPrefix} editFieldStart={editFieldStart} setEditFieldStart={setEditFieldStart} editFieldOptions={editFieldOptions} setEditFieldOptions={setEditFieldOptions} createCustomField={createCustomField} beginEditField={beginEditField} saveFieldEdit={saveFieldEdit} cancelFieldEdit={() => setEditingFieldId(null)} deleteCustomField={deleteCustomField} toggleFieldVisible={toggleFieldVisible} moveCustomField={moveCustomField} />}
      {panel === 'add' && <RecordPanel title="Add record" onClose={() => setPanel(null)}><RecordForm isAutoPopulate={isAutoPopulate} template={template} signerName={signerName} setSignerName={setSignerName} signerEmail={signerEmail} setSignerEmail={setSignerEmail} message={message} setMessage={setMessage} customFields={customFields} customValues={customValues} setCustomValues={setCustomValues} createRecord={createRecord} /></RecordPanel>}
      {panel === 'import' && <RecordPanel title="Import records" onClose={() => setPanel(null)}><ImportPanel importText={importText} setImportText={setImportText} importRecords={importRecords} isAutoPopulate={isAutoPopulate} /></RecordPanel>}
    </>
  )
}

function TemplateTab({ template, customFields, ensureTemplate, renameTemplate, deleteTemplate }: { template?: Form; customFields: ProjectCustomField[]; ensureTemplate: () => void; renameTemplate: (templateId: string, name: string) => void; deleteTemplate: (templateId: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(template?.name ?? 'Template')
  useEffect(() => setName(template?.name ?? 'Template'), [template?.name])
  return <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]"><section className="space-y-4"><div><h2 className="font-heading text-lg font-bold text-cti-black">Template mapping</h2><p className="mt-1 text-sm text-cti-gray">Use the custom fields from Settings as mapping targets in the PDF template.</p></div><div className="card space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{editing && template ? <div className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary" onClick={() => { renameTemplate(template.id, name); setEditing(false) }}>Save</button><button className="btn-ghost" onClick={() => { setName(template.name); setEditing(false) }}>Cancel</button></div> : <><p className="font-semibold text-cti-ink">{template?.name ?? 'Template'}</p><p className="text-sm text-cti-gray">{template?.template_path ? `Template ready - ${template.page_count} page(s)` : 'No PDF uploaded yet'}</p></>}</div>{template ? <Link to={`/forms/${template.id}/edit`} className="btn-primary whitespace-nowrap">Upload & map PDF</Link> : <button className="btn-primary" onClick={ensureTemplate}>Create template</button>}</div>{template && <div className="flex flex-wrap gap-2 border-t border-cti-line pt-3"><button className="btn-ghost px-3 py-2 text-xs" type="button" onClick={() => setEditing(true)}>Edit name</button><Link to={`/forms/${template.id}/edit`} className="btn-ghost px-3 py-2 text-xs">Replace PDF</Link><button className="btn-ghost px-3 py-2 text-xs text-cti-red" type="button" onClick={() => deleteTemplate(template.id)}>Delete template</button></div>}</div></section><aside className="card p-5"><h2 className="font-heading text-base font-bold text-cti-black">Custom fields</h2><div className="mt-4 space-y-2">{customFields.length === 0 && <p className="text-sm text-cti-gray">No fields yet. Add them in Setting.</p>}{customFields.map((field) => <div key={field.id} className="rounded-md border border-cti-line p-3"><p className="font-semibold text-cti-ink">{field.label}</p><p className="text-xs text-cti-gray">{fieldSummary(field)}</p></div>)}</div></aside></div>
}

function FormTab(props: { isAutoPopulate: boolean; template?: Form; records: SignRecord[]; visibleFields: ProjectCustomField[]; recordValues: Record<string, Record<string, string>>; selectedRecords: Record<string, boolean>; setSelectedRecords: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; massMarkSent: () => void; deleteRecord: (recordId: string) => void; markComplete: (recordId: string) => void; openPanel: (mode: PanelMode) => void }) {
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-lg font-bold text-cti-black">Records</h2><p className="text-sm text-cti-gray">{props.template?.template_path ? 'Table uses visible columns from Setting.' : 'Create and map a template before adding records.'}</p></div><div className="flex gap-2"><button className="btn-ghost" onClick={() => props.openPanel('import')} disabled={!props.template?.template_path}>Import records</button><button className="btn-primary" onClick={() => props.openPanel('add')} disabled={!props.template?.template_path}>+ Add record</button>{!props.isAutoPopulate && <button className="btn-dark" onClick={props.massMarkSent}>Mass send</button>}</div></div><RecordsTable isAutoPopulate={props.isAutoPopulate} records={props.records} fields={props.visibleFields} recordValues={props.recordValues} selectedRecords={props.selectedRecords} setSelectedRecords={props.setSelectedRecords} deleteRecord={props.deleteRecord} markComplete={props.markComplete} completed={false} /></section>
}

function CompletedTab({ isAutoPopulate, records, visibleFields, recordValues }: { isAutoPopulate: boolean; records: SignRecord[]; visibleFields: ProjectCustomField[]; recordValues: Record<string, Record<string, string>> }) {
  return <section><h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Completed</h2><RecordsTable isAutoPopulate={isAutoPopulate} records={records} fields={visibleFields} recordValues={recordValues} selectedRecords={{}} setSelectedRecords={() => {}} deleteRecord={() => {}} markComplete={() => {}} completed /></section>
}

type SettingTabProps = { customFields: ProjectCustomField[]; newFieldLabel: string; setNewFieldLabel: (value: string) => void; newFieldType: CustomFieldType; setNewFieldType: (value: CustomFieldType) => void; newFieldRequired: boolean; setNewFieldRequired: (value: boolean) => void; newFieldShow: boolean; setNewFieldShow: (value: boolean) => void; newFieldPrefix: string; setNewFieldPrefix: (value: string) => void; newFieldStart: number; setNewFieldStart: (value: number) => void; newFieldOptions: string; setNewFieldOptions: (value: string) => void; editingFieldId: string | null; editFieldLabel: string; setEditFieldLabel: (value: string) => void; editFieldType: CustomFieldType; setEditFieldType: (value: CustomFieldType) => void; editFieldRequired: boolean; setEditFieldRequired: (value: boolean) => void; editFieldShow: boolean; setEditFieldShow: (value: boolean) => void; editFieldPrefix: string; setEditFieldPrefix: (value: string) => void; editFieldStart: number; setEditFieldStart: (value: number) => void; editFieldOptions: string; setEditFieldOptions: (value: string) => void; createCustomField: (e: React.FormEvent) => void; beginEditField: (field: ProjectCustomField) => void; saveFieldEdit: (fieldId: string) => void; cancelFieldEdit: () => void; deleteCustomField: (fieldId: string) => void; toggleFieldVisible: (field: ProjectCustomField) => void; moveCustomField: (fieldId: string, direction: -1 | 1) => void }

function SettingTab(props: SettingTabProps) {
  return <section className="space-y-4"><div><h2 className="font-heading text-lg font-bold text-cti-black">Record columns</h2><p className="text-sm text-cti-gray">These fields are used in Template mapping, Form records, and Completed records.</p></div><form onSubmit={props.createCustomField} className="card grid gap-4 p-5 lg:grid-cols-[1fr_190px_140px_120px_auto_auto_auto]"><div><label className="label">Field label</label><input className="input" value={props.newFieldLabel} onChange={(e) => props.setNewFieldLabel(e.target.value)} /></div><div><label className="label">Type</label><FieldTypeSelect value={props.newFieldType} onChange={props.setNewFieldType} /></div>{props.newFieldType === 'auto_number' ? <><div><label className="label">Prefix</label><input className="input" value={props.newFieldPrefix} onChange={(e) => props.setNewFieldPrefix(e.target.value)} placeholder="CTI-" /></div><div><label className="label">Start from</label><input className="input" type="number" min={1} value={props.newFieldStart} onChange={(e) => props.setNewFieldStart(Number(e.target.value) || 1)} /></div></> : <><div></div><div></div></>}<label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.newFieldRequired} onChange={(e) => props.setNewFieldRequired(e.target.checked)} disabled={props.newFieldType === 'auto_number'} />Required</label><label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.newFieldShow} onChange={(e) => props.setNewFieldShow(e.target.checked)} />Show in form table</label><button className="btn-dark mt-6">+ Add</button>{isDropdownType(props.newFieldType) && <div className="lg:col-span-7"><label className="label">Options</label><textarea className="input" rows={4} value={props.newFieldOptions} onChange={(e) => props.setNewFieldOptions(e.target.value)} placeholder="One option per line or separated by comma" /></div>}</form><div className="space-y-2">{props.customFields.length === 0 && <EmptyState text="No custom fields yet." />}{props.customFields.map((field, index) => <FieldRow key={field.id} field={field} index={index} total={props.customFields.length} {...props} />)}</div></section>
}

function FieldRow(props: SettingTabProps & { field: ProjectCustomField; index: number; total: number }) {
  const field = props.field
  if (props.editingFieldId === field.id) return <div className="card grid gap-3 p-4 lg:grid-cols-[1fr_190px_140px_120px_auto_auto_auto]"><input className="input" value={props.editFieldLabel} onChange={(e) => props.setEditFieldLabel(e.target.value)} /><FieldTypeSelect value={props.editFieldType} onChange={props.setEditFieldType} />{props.editFieldType === 'auto_number' ? <><input className="input" value={props.editFieldPrefix} onChange={(e) => props.setEditFieldPrefix(e.target.value)} placeholder="Prefix" /><input className="input" type="number" min={1} value={props.editFieldStart} onChange={(e) => props.setEditFieldStart(Number(e.target.value) || 1)} /></> : <><div></div><div></div></>}<label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.editFieldRequired} onChange={(e) => props.setEditFieldRequired(e.target.checked)} disabled={props.editFieldType === 'auto_number'} />Required</label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.editFieldShow} onChange={(e) => props.setEditFieldShow(e.target.checked)} />Show in table</label><div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => props.saveFieldEdit(field.id)}>Save</button><button type="button" className="btn-ghost" onClick={props.cancelFieldEdit}>Cancel</button></div>{isDropdownType(props.editFieldType) && <div className="lg:col-span-7"><label className="label">Options</label><textarea className="input" rows={4} value={props.editFieldOptions} onChange={(e) => props.setEditFieldOptions(e.target.value)} placeholder="One option per line or separated by comma" /></div>}</div>
  return <div className="card flex items-center justify-between gap-3 p-4"><div><p className="font-semibold text-cti-ink">{field.label}</p><p className="text-xs text-cti-gray">{fieldSummary(field)}</p></div><div className="flex flex-wrap justify-end gap-2"><button className="btn-ghost px-2 py-1 text-xs" type="button" disabled={props.index === 0} onClick={() => props.moveCustomField(field.id, -1)}>Up</button><button className="btn-ghost px-2 py-1 text-xs" type="button" disabled={props.index === props.total - 1} onClick={() => props.moveCustomField(field.id, 1)}>Down</button><button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={() => props.toggleFieldVisible(field)}>{field.show_in_table ? 'Hide' : 'Show'}</button><button className="btn-ghost px-2 py-1 text-xs" type="button" onClick={() => props.beginEditField(field)}>Edit</button><button className="btn-ghost px-2 py-1 text-xs text-cti-red" type="button" onClick={() => props.deleteCustomField(field.id)}>Delete</button></div></div>
}

function RecordPanel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4"><div className="card max-h-[90vh] w-full max-w-3xl overflow-auto p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-heading text-lg font-bold text-cti-black">{title}</h2><button className="btn-ghost" onClick={onClose}>Close</button></div>{children}</div></div>
}

function RecordForm(props: { isAutoPopulate: boolean; template?: Form; signerName: string; setSignerName: (value: string) => void; signerEmail: string; setSignerEmail: (value: string) => void; message: string; setMessage: (value: string) => void; customFields: ProjectCustomField[]; customValues: Record<string, string>; setCustomValues: React.Dispatch<React.SetStateAction<Record<string, string>>>; createRecord: (e: React.FormEvent) => void }) {
  return <form onSubmit={props.createRecord} className="space-y-4"><div><label className="label">Template</label><input className="input" readOnly value={props.template?.name ?? 'Template not ready'} /></div>{!props.isAutoPopulate && <div className="grid gap-4 sm:grid-cols-2"><div><label className="label">Signer name</label><input className="input" value={props.signerName} onChange={(e) => props.setSignerName(e.target.value)} /></div><div><label className="label">Signer email</label><input className="input" type="email" value={props.signerEmail} onChange={(e) => props.setSignerEmail(e.target.value)} /></div></div>}<CustomValueInputs fields={props.customFields} values={props.customValues} setValues={props.setCustomValues} />{!props.isAutoPopulate && <div><label className="label">Message</label><textarea className="input" rows={3} value={props.message} onChange={(e) => props.setMessage(e.target.value)} /></div>}<button className="btn-primary">Create record</button></form>
}

function ImportPanel({ importText, setImportText, importRecords, isAutoPopulate }: { importText: string; setImportText: (value: string) => void; importRecords: () => void; isAutoPopulate: boolean }) {
  return <div className="space-y-3"><p className="text-sm text-cti-gray">Paste CSV with headers matching your field labels.{!isAutoPopulate ? ' Include signer_name and signer_email.' : ''} For multiple dropdown fields, separate selected options with comma.</p><textarea className="input font-mono text-xs" rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} /><button className="btn-dark" onClick={importRecords}>Import CSV</button></div>
}

function RecordsTable(props: { isAutoPopulate: boolean; records: SignRecord[]; fields: ProjectCustomField[]; recordValues: Record<string, Record<string, string>>; selectedRecords: Record<string, boolean>; setSelectedRecords: React.Dispatch<React.SetStateAction<Record<string, boolean>>> | (() => void); deleteRecord: (recordId: string) => void; markComplete: (recordId: string) => void; completed: boolean }) {
  return <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-cti-line bg-cti-bg text-xs uppercase text-cti-gray"><tr>{!props.completed && !props.isAutoPopulate && <th className="px-4 py-3"></th>}<th className="px-4 py-3">Created</th>{!props.isAutoPopulate && <th className="px-4 py-3">Signer</th>}<th className="px-4 py-3">Status</th>{props.fields.map((field) => <th key={field.id} className="px-4 py-3">{field.label}</th>)}<th className="px-4 py-3"></th></tr></thead><tbody>{props.records.length === 0 && <tr><td colSpan={props.fields.length + 5} className="px-4 py-6 text-center text-cti-gray">No records.</td></tr>}{props.records.map((record) => <tr key={record.id} className="border-b border-cti-line last:border-0">{!props.completed && !props.isAutoPopulate && <td className="px-4 py-3"><input type="checkbox" checked={Boolean(props.selectedRecords[record.id])} onChange={(e) => (props.setSelectedRecords as React.Dispatch<React.SetStateAction<Record<string, boolean>>>)((state) => ({ ...state, [record.id]: e.target.checked }))} /></td>}<td className="px-4 py-3 text-cti-gray">{new Date(record.created_at).toLocaleDateString()}</td>{!props.isAutoPopulate && <td className="px-4 py-3"><p className="font-semibold text-cti-ink">{record.signer_name}</p><p className="text-xs text-cti-gray">{record.signer_email}</p></td>}<td className="px-4 py-3"><StatusBadge status={record.status} /></td>{props.fields.map((field) => <td key={field.id} className="px-4 py-3 text-cti-gray">{props.recordValues[record.id]?.[field.id] ?? ''}</td>)}<td className="px-4 py-3 text-right"><div className="flex justify-end gap-2"><Link to={`/records/${record.id}`} className="font-semibold text-cti-red hover:underline">{props.completed ? 'View' : 'Edit'}</Link>{!props.completed && record.status === 'submitted' && <button className="font-semibold text-green-700 hover:underline" onClick={() => props.markComplete(record.id)}>Complete</button>}{!props.completed && <button className="font-semibold text-cti-gray hover:underline" onClick={() => props.deleteRecord(record.id)}>Delete</button>}</div></td></tr>)}</tbody></table></div>
}

function CustomValueInputs({ fields, values, setValues }: { fields: ProjectCustomField[]; values: Record<string, string>; setValues: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  if (!fields.length) return <p className="text-sm text-cti-gray">No custom fields yet. Add columns in Setting.</p>
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map((field) => <div key={field.id}><label className="label">{field.label}{field.required ? ' *' : ''}</label><CustomFieldInput field={field} value={values[field.id] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} /></div>)}</div>
}

function CustomFieldInput({ field, value, onChange }: { field: ProjectCustomField; value: string; onChange: (value: string) => void }) {
  const options = normalizeOptions(field.options)
  if (field.type === 'auto_number') return <input className="input" readOnly value="Auto generated" />
  if (field.type === 'single_dropdown') return <select className="input" required={field.required} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  if (field.type === 'multi_dropdown') {
    const selected = parseMultiValue(value)
    return <div className="rounded-md border border-cti-line bg-white p-3"><div className="grid gap-2 sm:grid-cols-2">{options.length === 0 && <p className="text-sm text-cti-gray">No options added.</p>}{options.map((option) => <label key={option} className="flex items-center gap-2 text-sm font-semibold text-cti-ink"><input type="checkbox" checked={selected.includes(option)} onChange={(e) => onChange(toggleMultiValue(value, option, e.target.checked))} />{option}</label>)}</div>{field.required && !selected.length && <input className="sr-only" required value="" onChange={() => {}} />}</div>
  }
  return <input className="input" type={inputTypeForCustomField(field)} required={field.required} value={value} onChange={(e) => onChange(e.target.value)} />
}

function FieldTypeSelect({ value, onChange }: { value: CustomFieldType; onChange: (value: CustomFieldType) => void }) {
  return <select className="input" value={value} onChange={(e) => onChange(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="date">Date</option><option value="number">Number</option><option value="email">Email</option><option value="auto_number">Auto-number</option><option value="single_dropdown">Single dropdown</option><option value="multi_dropdown">Multiple dropdown</option></select>
}

function fieldSummary(field: ProjectCustomField) {
  const optionCount = normalizeOptions(field.options).length
  const typeLabel = field.type === 'auto_number' ? `auto-number (${field.auto_prefix ?? ''}${field.auto_start ?? 1})` : field.type === 'single_dropdown' ? `single dropdown (${optionCount} options)` : field.type === 'multi_dropdown' ? `multiple dropdown (${optionCount} options)` : field.type
  const parts = [typeLabel]
  if (field.required) parts.push('required')
  parts.push(field.show_in_table ? 'shown in table' : 'hidden from table')
  return parts.join(' - ')
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

function parseTab(value: string | null): ProjectTab {
  return tabs.some((tab) => tab.id === value) ? (value as ProjectTab) : 'template'
}

function isDropdownType(type: CustomFieldType) {
  return type === 'single_dropdown' || type === 'multi_dropdown'
}

function optionTextToList(text: string) {
  return text.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean)
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((option) => option.trim()).filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return normalizeOptions(parsed)
    } catch {
      return optionTextToList(value)
    }
    return optionTextToList(value)
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

function inputTypeForCustomField(field: ProjectCustomField) {
  if (field.type === 'date') return 'date'
  if (field.type === 'email') return 'email'
  if (field.type === 'number') return 'number'
  return 'text'
}
