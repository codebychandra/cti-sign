import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { getAppSettings } from '../lib/settings'
import { buildSignedPdf } from '../lib/pdf'
import type { CustomFieldType, Form, Project, ProjectCustomField, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'
import { OneDriveConnectPanel } from '../components/OneDriveConnectPanel'

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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = parseTab(searchParams.get('tab'))
  const [project, setProject] = useState<Project | null>(null)
  const [forms, setForms] = useState<Form[]>([])
  const [records, setRecords] = useState<SignRecord[]>([])
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
    try {
      const [proj, fms, recs, fields] = await Promise.all([
        api.get<Project>('projects', projectId!),
        api.list<Form>('forms', { project_id: projectId! }),
        api.list<SignRecord>('records', { project_id: projectId! }),
        api.list<ProjectCustomField>('custom-fields', { project_id: projectId! }),
      ])
      setProject({ ...proj, project_type: proj.project_type ?? 'sent_signature' })
      setForms(fms.sort((a, b) => a.created_at.localeCompare(b.created_at)))
      setRecords(recs.sort((a, b) => b.created_at.localeCompare(a.created_at)))
      setCustomFields(
        fields
          .map((field) => ({ ...field, show_in_table: field.show_in_table ?? true, auto_prefix: field.auto_prefix ?? '', auto_start: field.auto_start ?? 1, options: normalizeOptions(field.options) }))
          .sort((a, b) => a.sort_order - b.sort_order),
      )
    } catch (e) {
      setError((e as Error).message)
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
    try {
      const created = await api.create<Form>('forms', { project_id: projectId, name: 'Template' })
      navigate(`/forms/${created.id}/edit`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const updateProject = async (patch: { name: string; description: string; project_type: Project['project_type'] }) => {
    if (!projectId) return
    try {
      await api.update('projects', projectId, patch)
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
    load()
  }

  const renameTemplate = async (templateId: string, name: string) => {
    const cleanName = name.trim()
    if (!cleanName) return
    try {
      await api.update('forms', templateId, { name: cleanName })
    } catch (e) {
      return setError((e as Error).message)
    }
    load()
  }

  const deleteTemplate = async (templateId: string) => {
    if (!window.confirm('Delete this template and its mapped fields?')) return
    try {
      await api.remove('forms', templateId)
    } catch (e) {
      return setError((e as Error).message)
    }
    load()
  }

  const createCustomField = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFieldLabel.trim()) return
    try {
      await api.create('custom-fields', {
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
    } catch (e) {
      return setError((e as Error).message)
    }
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
    try {
      await api.update('custom-fields', fieldId, {
        label: editFieldLabel.trim(),
        type: editFieldType,
        required: editFieldRequired,
        show_in_table: editFieldShow,
        auto_prefix: editFieldType === 'auto_number' ? editFieldPrefix.trim() : null,
        auto_start: editFieldType === 'auto_number' ? Number(editFieldStart) || 1 : 1,
        options: isDropdownType(editFieldType) ? optionTextToList(editFieldOptions) : [],
      })
    } catch (e) {
      return setError((e as Error).message)
    }
    setEditingFieldId(null)
    load()
  }

  const deleteCustomField = async (fieldId: string) => {
    try {
      await api.remove('custom-fields', fieldId)
    } catch (e) {
      return setError((e as Error).message)
    }
    load()
  }

  const toggleFieldVisible = async (field: ProjectCustomField) => {
    await api.update('custom-fields', field.id, { show_in_table: !field.show_in_table })
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
    await Promise.all(next.map((field, i) => api.update('custom-fields', field.id, { sort_order: i })))
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

  const buildCustomValueRows = (values: Record<string, string>) =>
    customFields.map((field) => ({ field_id: field.id, value: values[field.id]?.trim() ?? '' })).filter((row) => row.value)

  const createRecord = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!template || !template.has_template || missingRequiredCustom) return
    if (!isAutoPopulate && (!signerName.trim() || !signerEmail.trim())) return
    const values = withAutoNumbers(customValues)
    try {
      await api.create('records', {
        form_id: template.id,
        project_id: projectId,
        signer_name: isAutoPopulate ? 'Auto populate record' : signerName.trim(),
        signer_email: isAutoPopulate ? 'no-reply@cti.local' : signerEmail.trim(),
        message: isAutoPopulate ? '' : message.trim(),
        status: 'draft',
        values: [],
        custom_values: buildCustomValueRows(values),
      })
    } catch (e) {
      return setError((e as Error).message)
    }
    setSignerName('')
    setSignerEmail('')
    setMessage(getAppSettings().defaultSignatureMessage)
    setCustomValues({})
    setPanel(null)
    load()
  }

  const importRecords = async () => {
    if (!template || !template.has_template || !importText.trim()) return
    const rows = parseCsv(importText)
    if (!rows.length) return setError('No import rows found.')
    try {
      for (const [index, row] of rows.entries()) {
        const values: Record<string, string> = {}
        for (const field of customFields) values[field.id] = row[field.label] ?? row[field.label.toLowerCase()] ?? ''
        await api.create('records', {
          form_id: template.id,
          project_id: projectId,
          signer_name: isAutoPopulate ? 'Auto populate record' : row.signer_name || row.name || '',
          signer_email: isAutoPopulate ? 'no-reply@cti.local' : row.signer_email || row.email || '',
          message: isAutoPopulate ? '' : message.trim(),
          status: 'draft',
          values: [],
          custom_values: buildCustomValueRows(withAutoNumbers(values, index)),
        })
      }
    } catch (e) {
      return setError((e as Error).message)
    }
    setImportText('')
    setPanel(null)
    load()
  }

  const massMarkSent = async () => {
    const ids = Object.entries(selectedRecords).filter(([, selected]) => selected).map(([id]) => id)
    if (!ids.length) return
    setError(null)
    for (const id of ids) {
      try {
        await api.sendSignatureRequest(id, appBaseUrl())
      } catch (e) {
        setError((e as Error).message)
        break
      }
    }
    setSelectedRecords({})
    load()
  }

  const deleteRecord = async (recordId: string) => {
    if (!window.confirm('Delete this record and its data? This cannot be undone.')) return
    await api.remove('records', recordId)
    load()
  }

  const sendOne = async (recordId: string) => {
    setError(null)
    try {
      await api.sendSignatureRequest(recordId, appBaseUrl())
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  const markSubmitted = async (recordId: string) => {
    try {
      await api.update('records', recordId, { status: 'submitted', submitted_at: new Date().toISOString() })
    } catch (e) {
      setError((e as Error).message)
    }
    load()
  }

  const saveRecordCustomValues = async (recordId: string, values: Record<string, string>) => {
    const rows = customFields.map((field) => ({ field_id: field.id, value: values[field.id]?.trim() ?? '' }))
    try {
      await api.update('records', recordId, { custom_values: rows })
    } catch (e) {
      setError((e as Error).message)
      throw e
    }
    load()
  }

  const markComplete = async (recordId: string) => {
    await api.update('records', recordId, { status: 'completed', completed_at: new Date().toISOString() })
    try {
      await api.onedrive({ action: 'upload', record_id: recordId })
    } catch (e) {
      setError('Saved as completed, but OneDrive upload failed: ' + (e as Error).message)
    }
    load()
  }

  const downloadSignedPdf = async (record: SignRecord) => {
    setError(null)
    try {
      const { base64 } = await api.getSignedPdf(record.id)
      const bytes = base64ToArrayBuffer(base64)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${record.signer_name.replace(/\s+/g, '_')}_signed.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const downloadAutoPopulatePdf = async (record: SignRecord) => {
    if (!template?.has_template) return setError('Upload a template PDF first.')
    setError(null)
    try {
      const { base64 } = await api.getTemplate(template.id)
      const formFields = template.fields
      const customVals = record.custom_values
      const values = formFields
        .filter((f) => f.custom_field_id && customVals.some((v) => v.field_id === f.custom_field_id && v.value))
        .map((f) => ({ field_id: f.id, value: customVals.find((v) => v.field_id === f.custom_field_id)!.value }))
      const templateBytes = base64ToArrayBuffer(base64)
      const bytes = await buildSignedPdf(templateBytes, formFields, values)
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${(project?.name ?? 'record').replace(/\s+/g, '_')}-${record.id.slice(0, 8)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const viewLetter = async (record: SignRecord) => {
    setError(null)
    try {
      // Already signed via the real signer flow: show the actual stored signed PDF, not a
      // rebuilt one. Auto-populate records reuse 'submitted' as a lightweight "downloaded"
      // flag (see markSubmitted) and never get a real signed_pdf, so always rebuild those.
      if (!isAutoPopulate && (record.status === 'submitted' || record.status === 'completed')) {
        const { base64 } = await api.getSignedPdf(record.id)
        window.open(URL.createObjectURL(new Blob([base64ToArrayBuffer(base64) as BlobPart], { type: 'application/pdf' })), '_blank')
        return
      }
      if (!template?.has_template) return setError('Upload a template PDF first.')
      const { base64 } = await api.getTemplate(template.id)
      const formFields = template.fields
      const customVals = record.custom_values
      const values = formFields
        .filter((f) => f.custom_field_id && customVals.some((v) => v.field_id === f.custom_field_id && v.value))
        .map((f) => ({ field_id: f.id, value: customVals.find((v) => v.field_id === f.custom_field_id)!.value }))
      const templateBytes = base64ToArrayBuffer(base64)
      const bytes = await buildSignedPdf(templateBytes, formFields, values)
      window.open(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), '_blank')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (loading) return <p className="text-cti-gray">Loading...</p>
  if (!project) return <p className="text-cti-red">Project not found.</p>

  return (
    <>
      <PageHeader title={project.name} subtitle={isAutoPopulate ? 'Auto-populate PDF workflow' : 'Signature request workflow'} actions={<Link to="/" className="btn-ghost">All projects</Link>} />
      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}
      <div className="mb-6 overflow-x-auto border-b border-cti-line"><div className="flex min-w-max gap-2">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setSearchParams(tab.id === 'template' ? {} : { tab: tab.id })} className={`border-b-2 px-4 py-3 text-left transition-colors ${activeTab === tab.id ? 'border-cti-red text-cti-black' : 'border-transparent text-cti-gray hover:text-cti-ink'}`}><span className="block text-sm font-bold">{tab.label}</span></button>)}</div></div>
      {activeTab === 'template' && <TemplateTab projectId={projectId!} template={template} customFields={customFields} ensureTemplate={ensureTemplate} renameTemplate={renameTemplate} deleteTemplate={deleteTemplate} fieldsManagerProps={{ customFields, newFieldLabel, setNewFieldLabel, newFieldType, setNewFieldType, newFieldRequired, setNewFieldRequired, newFieldShow, setNewFieldShow, newFieldPrefix, setNewFieldPrefix, newFieldStart, setNewFieldStart, newFieldOptions, setNewFieldOptions, editingFieldId, editFieldLabel, setEditFieldLabel, editFieldType, setEditFieldType, editFieldRequired, setEditFieldRequired, editFieldShow, setEditFieldShow, editFieldPrefix, setEditFieldPrefix, editFieldStart, setEditFieldStart, editFieldOptions, setEditFieldOptions, createCustomField, beginEditField, saveFieldEdit, cancelFieldEdit: () => setEditingFieldId(null), deleteCustomField, toggleFieldVisible, moveCustomField }} />}
      {activeTab === 'form' && <FormTab isAutoPopulate={isAutoPopulate} template={template} records={activeRecords} visibleFields={visibleFields} selectedRecords={selectedRecords} setSelectedRecords={setSelectedRecords} massMarkSent={massMarkSent} deleteRecord={deleteRecord} markComplete={markComplete} markSubmitted={markSubmitted} sendOne={sendOne} downloadPdf={downloadAutoPopulatePdf} downloadSignedPdf={downloadSignedPdf} viewLetter={viewLetter} saveCustomValues={saveRecordCustomValues} openPanel={setPanel} />}
      {activeTab === 'completed' && <CompletedTab isAutoPopulate={isAutoPopulate} records={completedRecords} visibleFields={visibleFields} downloadPdf={downloadAutoPopulatePdf} downloadSignedPdf={downloadSignedPdf} viewLetter={viewLetter} saveCustomValues={saveRecordCustomValues} />}
      {activeTab === 'setting' && <ProjectSettingTab projectId={projectId!} project={project} updateProject={updateProject} />}
      {panel === 'add' && <RecordPanel title="Add record" onClose={() => setPanel(null)}><RecordForm isAutoPopulate={isAutoPopulate} template={template} signerName={signerName} setSignerName={setSignerName} signerEmail={signerEmail} setSignerEmail={setSignerEmail} message={message} setMessage={setMessage} customFields={customFields} customValues={customValues} setCustomValues={setCustomValues} createRecord={createRecord} /></RecordPanel>}
      {panel === 'import' && <RecordPanel title="Import records" onClose={() => setPanel(null)}><ImportPanel importText={importText} setImportText={setImportText} importRecords={importRecords} isAutoPopulate={isAutoPopulate} /></RecordPanel>}
    </>
  )
}

function TemplateTab({ template, ensureTemplate, renameTemplate, deleteTemplate, fieldsManagerProps }: { projectId: string; template?: Form; customFields: ProjectCustomField[]; ensureTemplate: () => void; renameTemplate: (templateId: string, name: string) => void; deleteTemplate: (templateId: string) => void; fieldsManagerProps: SettingTabProps }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(template?.name ?? 'Template')
  useEffect(() => setName(template?.name ?? 'Template'), [template?.name])
  return <div className="space-y-8"><section className="space-y-4"><div><h2 className="font-heading text-lg font-bold text-cti-black">Template PDF</h2><p className="mt-1 text-sm text-cti-gray">Upload the PDF and map fields onto it. Define input fields below first so they're available to map.</p></div><div className="card space-y-4 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1">{editing && template ? <div className="flex gap-2"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary" onClick={() => { renameTemplate(template.id, name); setEditing(false) }}>Save</button><button className="btn-ghost" onClick={() => { setName(template.name); setEditing(false) }}>Cancel</button></div> : <><p className="font-semibold text-cti-ink">{template?.name ?? 'Template'}</p><p className="text-sm text-cti-gray">{template?.has_template ? `Template ready - ${template.page_count} page(s)` : 'No PDF uploaded yet'}</p></>}</div>{template ? <Link to={`/forms/${template.id}/edit`} className="btn-primary whitespace-nowrap">Upload & map PDF</Link> : <button className="btn-primary whitespace-nowrap" onClick={ensureTemplate}>Upload & map PDF</button>}</div>{template && <div className="flex flex-wrap gap-2 border-t border-cti-line pt-3"><button className="btn-ghost px-3 py-2 text-xs" type="button" onClick={() => setEditing(true)}>Edit name</button><Link to={`/forms/${template.id}/edit`} className="btn-ghost px-3 py-2 text-xs">Replace PDF</Link><button className="btn-ghost px-3 py-2 text-xs text-cti-red" type="button" onClick={() => deleteTemplate(template.id)}>Delete template</button></div>}</div></section><SettingTab {...fieldsManagerProps} /></div>
}

const projectTypeOptions: { value: Project['project_type']; label: string; description: string }[] = [
  { value: 'sent_signature', label: 'Sent signature', description: 'Send records to crew for signature and admin completion.' },
  { value: 'auto_populate', label: 'Auto populate', description: 'Map PDF templates and generate documents from record values only.' },
]

function ProjectSettingTab({ projectId, project, updateProject }: { projectId: string; project: Project | null; updateProject: (patch: { name: string; description: string; project_type: Project['project_type'] }) => Promise<void> }) {
  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [projectType, setProjectType] = useState<Project['project_type']>(project?.project_type ?? 'sent_signature')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setProjectType(project?.project_type ?? 'sent_signature')
  }, [project?.id, project?.name, project?.description, project?.project_type])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateProject({ name: name.trim(), description: description.trim(), project_type: projectType })
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch {
      // error already surfaced by updateProject
    }
    setSaving(false)
  }

  return (
    <div className="max-w-md space-y-6">
      <form onSubmit={save} className="card space-y-4 p-5">
        <h2 className="font-heading text-lg font-bold text-cti-black">Project details</h2>
        <div>
          <label className="label">Project name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <label className="label">Project type</label>
          <div className="grid gap-3 sm:grid-cols-2">
            {projectTypeOptions.map((type) => (
              <label key={type.value} className={`rounded-md border p-4 ${projectType === type.value ? 'border-cti-red bg-red-50' : 'border-cti-line bg-white'}`}>
                <span className="flex items-center gap-2 font-semibold text-cti-ink">
                  <input type="radio" name="projectTypeEdit" value={type.value} checked={projectType === type.value} onChange={() => setProjectType(type.value)} />
                  {type.label}
                </span>
                <span className="mt-1 block text-sm text-cti-gray">{type.description}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          {saved && <span className="text-sm font-semibold text-cti-ink">Saved</span>}
        </div>
      </form>

      <OneDriveConnectPanel projectId={projectId} />
    </div>
  )
}

function FormTab(props: { isAutoPopulate: boolean; template?: Form; records: SignRecord[]; visibleFields: ProjectCustomField[]; selectedRecords: Record<string, boolean>; setSelectedRecords: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; massMarkSent: () => void; deleteRecord: (recordId: string) => void; markComplete: (recordId: string) => void; markSubmitted: (recordId: string) => void; sendOne: (recordId: string) => void; downloadPdf: (record: SignRecord) => void; downloadSignedPdf: (record: SignRecord) => void; viewLetter: (record: SignRecord) => void; saveCustomValues: (recordId: string, values: Record<string, string>) => Promise<void>; openPanel: (mode: PanelMode) => void }) {
  return <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-lg font-bold text-cti-black">Records</h2><p className="text-sm text-cti-gray">{props.template?.has_template ? 'Table uses visible columns from the Template tab. Cell values save inline; use the action icons for send, timeline, letter, reminder, complete and delete.' : 'Create and map a template before adding records.'}</p></div><div className="flex gap-2"><button className="btn-ghost" onClick={() => props.openPanel('import')} disabled={!props.template?.has_template}>Import records</button><button className="btn-primary" onClick={() => props.openPanel('add')} disabled={!props.template?.has_template}>+ Add record</button>{!props.isAutoPopulate && <button className="btn-dark" onClick={props.massMarkSent}>Mass send</button>}</div></div><RecordsTable isAutoPopulate={props.isAutoPopulate} records={props.records} fields={props.visibleFields} selectedRecords={props.selectedRecords} setSelectedRecords={props.setSelectedRecords} deleteRecord={props.deleteRecord} markComplete={props.markComplete} markSubmitted={props.markSubmitted} sendOne={props.sendOne} downloadPdf={props.downloadPdf} downloadSignedPdf={props.downloadSignedPdf} viewLetter={props.viewLetter} saveCustomValues={props.saveCustomValues} completed={false} /></section>
}

function CompletedTab({ isAutoPopulate, records, visibleFields, downloadPdf, downloadSignedPdf, viewLetter, saveCustomValues }: { isAutoPopulate: boolean; records: SignRecord[]; visibleFields: ProjectCustomField[]; downloadPdf: (record: SignRecord) => void; downloadSignedPdf: (record: SignRecord) => void; viewLetter: (record: SignRecord) => void; saveCustomValues: (recordId: string, values: Record<string, string>) => Promise<void> }) {
  return <section><h2 className="mb-3 font-heading text-lg font-bold text-cti-black">Completed</h2><RecordsTable isAutoPopulate={isAutoPopulate} records={records} fields={visibleFields} selectedRecords={{}} setSelectedRecords={() => {}} deleteRecord={() => {}} markComplete={() => {}} markSubmitted={() => {}} sendOne={() => {}} downloadPdf={downloadPdf} downloadSignedPdf={downloadSignedPdf} viewLetter={viewLetter} saveCustomValues={saveCustomValues} completed /></section>
}

type SettingTabProps = { customFields: ProjectCustomField[]; newFieldLabel: string; setNewFieldLabel: (value: string) => void; newFieldType: CustomFieldType; setNewFieldType: (value: CustomFieldType) => void; newFieldRequired: boolean; setNewFieldRequired: (value: boolean) => void; newFieldShow: boolean; setNewFieldShow: (value: boolean) => void; newFieldPrefix: string; setNewFieldPrefix: (value: string) => void; newFieldStart: number; setNewFieldStart: (value: number) => void; newFieldOptions: string; setNewFieldOptions: (value: string) => void; editingFieldId: string | null; editFieldLabel: string; setEditFieldLabel: (value: string) => void; editFieldType: CustomFieldType; setEditFieldType: (value: CustomFieldType) => void; editFieldRequired: boolean; setEditFieldRequired: (value: boolean) => void; editFieldShow: boolean; setEditFieldShow: (value: boolean) => void; editFieldPrefix: string; setEditFieldPrefix: (value: string) => void; editFieldStart: number; setEditFieldStart: (value: number) => void; editFieldOptions: string; setEditFieldOptions: (value: string) => void; createCustomField: (e: React.FormEvent) => void; beginEditField: (field: ProjectCustomField) => void; saveFieldEdit: (fieldId: string) => void; cancelFieldEdit: () => void; deleteCustomField: (fieldId: string) => void; toggleFieldVisible: (field: ProjectCustomField) => void; moveCustomField: (fieldId: string, direction: -1 | 1) => void }

function SettingTab(props: SettingTabProps) {
  return <section className="space-y-4"><div><h2 className="font-heading text-lg font-bold text-cti-black">Input fields</h2><p className="text-sm text-cti-gray">Define fields here, then map them onto the PDF above. They also appear on the Form and Completed tabs.</p></div><form onSubmit={props.createCustomField} className="card grid gap-4 p-5 lg:grid-cols-[1fr_190px_140px_120px_auto_auto_auto]"><div><label className="label">Field label</label><input className="input" value={props.newFieldLabel} onChange={(e) => props.setNewFieldLabel(e.target.value)} /></div><div><label className="label">Type</label><FieldTypeSelect value={props.newFieldType} onChange={props.setNewFieldType} /></div>{props.newFieldType === 'auto_number' ? <><div><label className="label">Prefix</label><input className="input" value={props.newFieldPrefix} onChange={(e) => props.setNewFieldPrefix(e.target.value)} placeholder="CTI-" /></div><div><label className="label">Start from</label><input className="input" type="number" min={1} value={props.newFieldStart} onChange={(e) => props.setNewFieldStart(Number(e.target.value) || 1)} /></div></> : <><div></div><div></div></>}<label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.newFieldRequired} onChange={(e) => props.setNewFieldRequired(e.target.checked)} disabled={props.newFieldType === 'auto_number'} />Required</label><label className="mt-7 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.newFieldShow} onChange={(e) => props.setNewFieldShow(e.target.checked)} />Show in form table</label><button className="btn-dark mt-6">+ Add</button>{isDropdownType(props.newFieldType) && <div className="lg:col-span-7"><OptionListEditor value={props.newFieldOptions} onChange={props.setNewFieldOptions} /></div>}</form>{props.customFields.length === 0 ? <EmptyState text="No custom fields yet." /> : <div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-cti-line bg-cti-bg text-xs uppercase text-cti-gray"><tr><th className="px-4 py-3">Label</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Required</th><th className="px-4 py-3">Table</th><th className="px-4 py-3 text-right">Actions</th></tr></thead><tbody>{props.customFields.map((field, index) => <FieldRow key={field.id} field={field} index={index} total={props.customFields.length} {...props} />)}</tbody></table></div>}</section>
}

function FieldRow(props: SettingTabProps & { field: ProjectCustomField; index: number; total: number }) {
  const field = props.field
  if (props.editingFieldId === field.id) return <tr className="border-b border-cti-line last:border-0"><td colSpan={5} className="p-4"><div className="grid gap-3 lg:grid-cols-[1fr_190px_140px_120px_auto_auto_auto]"><input className="input" value={props.editFieldLabel} onChange={(e) => props.setEditFieldLabel(e.target.value)} /><FieldTypeSelect value={props.editFieldType} onChange={props.setEditFieldType} />{props.editFieldType === 'auto_number' ? <><input className="input" value={props.editFieldPrefix} onChange={(e) => props.setEditFieldPrefix(e.target.value)} placeholder="Prefix" /><input className="input" type="number" min={1} value={props.editFieldStart} onChange={(e) => props.setEditFieldStart(Number(e.target.value) || 1)} /></> : <><div></div><div></div></>}<label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.editFieldRequired} onChange={(e) => props.setEditFieldRequired(e.target.checked)} disabled={props.editFieldType === 'auto_number'} />Required</label><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={props.editFieldShow} onChange={(e) => props.setEditFieldShow(e.target.checked)} />Show in table</label><div className="flex gap-2"><button type="button" className="btn-primary" onClick={() => props.saveFieldEdit(field.id)}>Save</button><button type="button" className="btn-ghost" onClick={props.cancelFieldEdit}>Cancel</button></div></div>{isDropdownType(props.editFieldType) && <div className="mt-3"><OptionListEditor value={props.editFieldOptions} onChange={props.setEditFieldOptions} /></div>}</td></tr>
  return <tr className="border-b border-cti-line last:border-0"><td className="px-4 py-3"><p className="font-semibold text-cti-ink">{field.label}</p></td><td className="px-4 py-3 text-cti-gray">{fieldTypeLabel(field)}</td><td className="px-4 py-3 text-cti-gray">{field.required ? 'Yes' : 'No'}</td><td className="px-4 py-3 text-cti-gray">{field.show_in_table ? 'Shown' : 'Hidden'}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><IconButton label="Move up" disabled={props.index === 0} onClick={() => props.moveCustomField(field.id, -1)}><ArrowUpIcon /></IconButton><IconButton label="Move down" disabled={props.index === props.total - 1} onClick={() => props.moveCustomField(field.id, 1)}><ArrowDownIcon /></IconButton><IconButton label={field.show_in_table ? 'Hide from table' : 'Show in table'} onClick={() => props.toggleFieldVisible(field)}>{field.show_in_table ? <EyeOffIcon /> : <EyeIcon />}</IconButton><IconButton label="Edit field" onClick={() => props.beginEditField(field)}><PencilIcon /></IconButton><IconButton label="Delete field" tone="danger" onClick={() => props.deleteCustomField(field.id)}><TrashIcon /></IconButton></div></td></tr>
}

function IconButton({ label, onClick, disabled, tone, children }: { label: string; onClick: () => void; disabled?: boolean; tone?: 'danger'; children: React.ReactNode }) {
  const toneClass = tone === 'danger' ? 'text-cti-red hover:bg-red-50' : 'text-cti-ink'
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`grid h-8 w-8 shrink-0 place-items-center rounded-md border border-cti-line transition-colors hover:bg-cti-bg disabled:cursor-not-allowed disabled:opacity-30 ${toneClass}`}>{children}</button>
}

function ArrowUpIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 15.5V4.5M10 4.5L4.5 10M10 4.5L15.5 10" /></svg>
}

function ArrowDownIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 4.5V15.5M10 15.5L4.5 10M10 15.5L15.5 10" /></svg>
}

function EyeIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" /><circle cx="10" cy="10" r="2.25" /></svg>
}

function EyeOffIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M2.5 2.5l15 15M8.35 8.4a2.25 2.25 0 0 0 3.2 3.2M6.1 6.16C3.9 7.4 1.5 10 1.5 10s3 6 8.5 6c1.5 0 2.8-.44 3.87-1.07M11.9 4.24C11.29 4.1 10.66 4 10 4c-.35 0-.68.02-1 .06M15.6 6.1c1.68 1.32 2.9 3.9 2.9 3.9s-.72 1.45-2 2.87" /></svg>
}

function PencilIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M13.5 3.5a1.7 1.7 0 0 1 2.4 2.4L6.5 15.3l-3.2.7.7-3.2 9.5-9.3Z" /></svg>
}

function TrashIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M6 5.5v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-10M8.5 9v4M11.5 9v4" /></svg>
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

type RecordsTableProps = {
  isAutoPopulate: boolean
  records: SignRecord[]
  fields: ProjectCustomField[]
  selectedRecords: Record<string, boolean>
  setSelectedRecords: React.Dispatch<React.SetStateAction<Record<string, boolean>>> | (() => void)
  deleteRecord: (recordId: string) => void
  markComplete: (recordId: string) => void
  markSubmitted: (recordId: string) => void
  sendOne: (recordId: string) => void
  downloadPdf: (record: SignRecord) => void
  downloadSignedPdf: (record: SignRecord) => void
  viewLetter: (record: SignRecord) => void
  saveCustomValues: (recordId: string, values: Record<string, string>) => Promise<void>
  completed: boolean
}

function RecordsTable(props: RecordsTableProps) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full border-collapse text-center text-sm">
        <thead className="border-b border-cti-line bg-cti-bg text-xs uppercase tracking-wide text-cti-gray">
          <tr>
            <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Action</th>
            <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Status</th>
            <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Created</th>
            {!props.isAutoPopulate && <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Signer</th>}
            {props.fields.map((field, i) => <th key={field.id} className={`whitespace-nowrap px-4 py-3 ${i < props.fields.length - 1 ? 'border-r border-cti-line' : ''}`}>{field.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-cti-line">
          {props.records.length === 0 && <tr><td colSpan={props.fields.length + 4} className="px-4 py-6 text-center text-cti-gray">No records.</td></tr>}
          {props.records.map((record) => <RecordRow key={record.id} record={record} {...props} />)}
        </tbody>
      </table>
    </div>
  )
}

function RecordRow(props: RecordsTableProps & { record: SignRecord }) {
  const { record } = props
  const [values, setValues] = useState<Record<string, string>>(() => valuesFromRecord(record, props.fields))
  const [savedValues, setSavedValues] = useState(values)
  const [saving, setSaving] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)
  const isSubmitted = record.status === 'submitted'
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues)

  useEffect(() => {
    const next = valuesFromRecord(record, props.fields)
    setValues(next)
    setSavedValues(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.custom_values])

  const save = async () => {
    setSaving(true)
    try {
      await props.saveCustomValues(record.id, values)
      setSavedValues(values)
    } catch {
      // error already surfaced by the parent
    }
    setSaving(false)
  }

  const downloadAndAdvance = () => {
    props.downloadPdf(record)
    if (record.status === 'draft') props.markSubmitted(record.id)
  }

  return (
    <tr className="align-middle hover:bg-cti-bg">
      <td className="whitespace-nowrap border-r border-cti-line px-4 py-3">
        <div className="mx-auto flex w-max flex-nowrap items-center gap-1.5">
          {!props.completed && !props.isAutoPopulate && (
            <input type="checkbox" className="mr-0.5 h-4 w-4 shrink-0" checked={Boolean(props.selectedRecords[record.id])} onChange={(e) => (props.setSelectedRecords as React.Dispatch<React.SetStateAction<Record<string, boolean>>>)((state) => ({ ...state, [record.id]: e.target.checked }))} />
          )}
          {!props.completed && !props.isAutoPopulate && record.status === 'draft' && <SendButton label="Send" onClick={() => props.sendOne(record.id)} />}
          {!props.completed && !props.isAutoPopulate && (record.status === 'sent' || record.status === 'viewed') && <PendingBadge />}
          {!props.completed && !props.isAutoPopulate && isSubmitted && <SendButton label="Complete" onClick={() => props.markComplete(record.id)} />}
          {!props.completed && props.isAutoPopulate && record.status === 'draft' && <SendButton label="Download" onClick={downloadAndAdvance} />}
          {!props.completed && props.isAutoPopulate && record.status !== 'draft' && <SendButton label="Complete" onClick={() => props.markComplete(record.id)} />}
          {dirty && <RowActionIcon label="Save changes" tone="save" onClick={save} disabled={saving}><SaveIcon /></RowActionIcon>}
          {!props.isAutoPopulate && <TimelineButton record={record} open={showTimeline} onToggle={() => setShowTimeline((v) => !v)} />}
          <RowActionIcon label="View letter" tone="letter" onClick={() => props.viewLetter(record)}><LetterIcon /></RowActionIcon>
          {!props.completed && !props.isAutoPopulate && <RowActionIcon label="Send reminder" tone="reminder" onClick={() => props.sendOne(record.id)}><BellIcon /></RowActionIcon>}
          {props.completed && props.isAutoPopulate && <RowActionIcon label="Download PDF" tone="neutral" onClick={() => props.downloadPdf(record)}><DownloadIcon /></RowActionIcon>}
          {props.completed && !props.isAutoPopulate && <RowActionIcon label="Download signed PDF" tone="neutral" onClick={() => props.downloadSignedPdf(record)}><DownloadIcon /></RowActionIcon>}
          {props.completed && !props.isAutoPopulate && record.onedrive_url && <RowActionIcon label="Open copy in OneDrive" tone="letter" onClick={() => window.open(record.onedrive_url!, '_blank')}><ExternalLinkIcon /></RowActionIcon>}
          {!props.completed && <RowActionIcon label="Delete record" tone="danger" onClick={() => props.deleteRecord(record.id)}><TrashIcon /></RowActionIcon>}
        </div>
      </td>
      <td className="border-r border-cti-line px-4 py-3"><StatusBadge status={record.status} /></td>
      <td className="whitespace-nowrap border-r border-cti-line px-4 py-3 text-cti-gray">{new Date(record.created_at).toLocaleDateString()}</td>
      {!props.isAutoPopulate && <td className="border-r border-cti-line px-4 py-3"><p className="font-semibold text-cti-ink">{record.signer_name}</p><p className="text-xs text-cti-gray">{record.signer_email}</p></td>}
      {props.fields.map((field, i) => (
        <td key={field.id} className={`min-w-[160px] px-4 py-2.5 ${i < props.fields.length - 1 ? 'border-r border-cti-line' : ''}`}>
          <CustomFieldInput field={field} variant="cell" disabled={props.completed || field.type === 'auto_number'} value={values[field.id] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} />
        </td>
      ))}
    </tr>
  )
}

function valuesFromRecord(record: SignRecord, fields: ProjectCustomField[]) {
  const byField = Object.fromEntries(record.custom_values.map((v) => [v.field_id, v.value ?? '']))
  return Object.fromEntries(fields.map((field) => [field.id, byField[field.id] ?? '']))
}

function TimelineButton({ record, open, onToggle }: { record: SignRecord; open: boolean; onToggle: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 4, left: rect.left })
    const onScrollOrResize = () => onToggle()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <button ref={buttonRef} type="button" title="Timeline" aria-label="Timeline" onClick={onToggle} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors ${rowActionTones.timeline}`}>
        <ClockIcon />
      </button>
      {open && position && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="fixed z-50" style={{ top: position.top, left: position.left }}>
            <Timeline record={record} />
          </div>
        </>,
        document.body,
      )}
    </>
  )
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
    <div className="card w-64 p-4 shadow-lg">
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

function SendButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex shrink-0 items-center gap-1.5 rounded-md border border-cti-blue bg-white px-3 py-1 text-xs font-bold text-cti-blue transition-colors hover:bg-blue-50"><SendIcon />{label}</button>
}

function PendingBadge() {
  return <span className="flex shrink-0 items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-500">Pending</span>
}

const rowActionTones = {
  save: 'border-cti-red bg-cti-red text-white hover:bg-cti-redDark',
  timeline: 'border-green-500 bg-white text-green-600 hover:bg-green-50',
  letter: 'border-cti-blue bg-white text-cti-blue hover:bg-blue-50',
  reminder: 'border-amber-400 bg-white text-amber-500 hover:bg-amber-50',
  danger: 'border-cti-red bg-white text-cti-red hover:bg-red-50',
  neutral: 'border-cti-line bg-white text-cti-gray hover:bg-cti-bg',
} as const

function RowActionIcon({ label, onClick, disabled, tone, children }: { label: string; onClick: () => void; disabled?: boolean; tone: keyof typeof rowActionTones; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${rowActionTones[tone]}`}>{children}</button>
}

function SendIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M17.5 2.5 2.5 8.5l5.5 2.5 2.5 5.5 6.5-14Z" /><path d="M8 11l4.5-4.5" /></svg>
}

function ClockIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5V10l3 2" /></svg>
}

function ExternalLinkIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M8 4H4.5a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1H15a1 1 0 0 0 1-1V12" /><path d="M9 11 16 4M11.5 4H16v4.5" /></svg>
}

function LetterIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M5.5 2.5h6L15 5.5v11a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z" /><path d="M11.5 2.5V6H15M7 9.5h6M7 12.5h6" /></svg>
}

function BellIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M10 2.5a1 1 0 0 0-1 1v.6C6.6 4.6 5 6.6 5 9v3l-1.5 2h13L15 12V9c0-2.4-1.6-4.4-4-4.9V3.5a1 1 0 0 0-1-1Z" /><path d="M8 16a2 2 0 0 0 4 0" /></svg>
}

function DownloadIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 3v9.5M6.5 9l3.5 3.5L13.5 9" /><path d="M3.5 14v1.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V14" /></svg>
}

function SaveIcon() {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M4 3.5h9L16.5 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" /><path d="M6.5 3.5V8h6V3.5M6.5 17v-5h7v5" /></svg>
}

function CustomValueInputs({ fields, values, setValues }: { fields: ProjectCustomField[]; values: Record<string, string>; setValues: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  if (!fields.length) return <p className="text-sm text-cti-gray">No custom fields yet. Add columns in Setting.</p>
  return <div className="grid gap-4 sm:grid-cols-2">{fields.map((field) => <div key={field.id}><label className="label">{field.label}{field.required ? ' *' : ''}</label><CustomFieldInput field={field} value={values[field.id] ?? ''} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} /></div>)}</div>
}

function CustomFieldInput({ field, value, onChange, disabled, variant = 'default' }: { field: ProjectCustomField; value: string; onChange: (value: string) => void; disabled?: boolean; variant?: 'default' | 'cell' }) {
  const options = normalizeOptions(field.options)
  const inputClass = variant === 'cell' ? 'input-cell' : 'input'
  if (field.type === 'auto_number') return <input className={inputClass} readOnly value={value || 'Auto generated'} />
  if (field.type === 'single_dropdown') return <select className={inputClass} required={field.required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Select...</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>
  if (field.type === 'multi_dropdown') {
    const selected = parseMultiValue(value)
    return <div className={variant === 'cell' ? 'rounded-md border border-transparent p-1' : 'rounded-md border border-cti-line bg-white p-3'}><div className="grid gap-2 sm:grid-cols-2">{options.length === 0 && <p className="text-sm text-cti-gray">No options added.</p>}{options.map((option) => <label key={option} className="flex items-center gap-2 text-sm font-semibold text-cti-ink"><input type="checkbox" disabled={disabled} checked={selected.includes(option)} onChange={(e) => onChange(toggleMultiValue(value, option, e.target.checked))} />{option}</label>)}</div>{field.required && !selected.length && <input className="sr-only" required value="" onChange={() => {}} />}</div>
  }
  return <input className={inputClass} type={inputTypeForCustomField(field)} required={field.required} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
}

function FieldTypeSelect({ value, onChange }: { value: CustomFieldType; onChange: (value: CustomFieldType) => void }) {
  return <select className="input" value={value} onChange={(e) => onChange(e.target.value as CustomFieldType)}><option value="text">Text</option><option value="date">Date</option><option value="number">Number</option><option value="email">Email</option><option value="auto_number">Auto-number</option><option value="single_dropdown">Single dropdown</option><option value="multi_dropdown">Multiple dropdown</option></select>
}

function fieldTypeLabel(field: ProjectCustomField) {
  const optionCount = normalizeOptions(field.options).length
  if (field.type === 'auto_number') return `Auto-number (${field.auto_prefix ?? ''}${field.auto_start ?? 1})`
  if (field.type === 'single_dropdown') return `Single dropdown (${optionCount} options)`
  if (field.type === 'multi_dropdown') return `Multiple dropdown (${optionCount} options)`
  return field.type.charAt(0).toUpperCase() + field.type.slice(1)
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

function OptionListEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')
  // Real local state, not derived fresh from `value` on every render: joining
  // an array containing exactly one blank entry with '\n' produces the same
  // '' as an empty array, so a naive derive-from-string approach can never
  // let a freshly-added blank row survive long enough to be typed into.
  // `lastEmitted` distinguishes "value changed because we just sent it up"
  // from "value changed because the parent reset it externally" (e.g. after
  // a successful create, or switching which field is being edited).
  const [options, setOptionsState] = useState<string[]>(() => (value ? optionTextToList(value) : []))
  const lastEmitted = useRef(value)

  useEffect(() => {
    if (value !== lastEmitted.current) {
      setOptionsState(value ? optionTextToList(value) : [])
      lastEmitted.current = value
    }
  }, [value])

  const setOptions = (next: string[]) => {
    setOptionsState(next)
    const joined = next.join('\n')
    lastEmitted.current = joined
    onChange(joined)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label mb-0">Pick List Option</label>
        <button type="button" className="text-xs font-semibold text-cti-gray hover:text-cti-ink" onClick={() => setOptions([...options].sort((a, b) => a.localeCompare(b)))}>
          Sort A-Z
        </button>
      </div>
      <div className="mt-2 space-y-2 rounded-md bg-cti-bg p-2">
        {options.length === 0 && <p className="p-2 text-xs text-cti-gray">No options yet.</p>}
        {options.map((option, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input flex-1 bg-white"
              value={option}
              onChange={(e) => setOptions(options.map((o, idx) => (idx === i ? e.target.value : o)))}
            />
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOptions(options.filter((_, idx) => idx !== i))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" className="text-xs font-semibold text-cti-red hover:underline" onClick={() => setOptions([...options, ''])}>
          + Add option
        </button>
        <button type="button" className="text-xs font-semibold text-cti-blue hover:underline" onClick={() => setBulkMode((v) => !v)}>
          {bulkMode ? 'Cancel bulk add' : '+ Add Options in Bulk'}
        </button>
      </div>
      {bulkMode && (
        <div className="mt-2 space-y-2 rounded-md border border-cti-line p-2">
          <textarea
            className="input"
            rows={4}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder="One option per line or separated by comma"
          />
          <button
            type="button"
            className="btn-dark px-3 py-1.5 text-xs"
            onClick={() => {
              setOptions([...options, ...optionTextToList(bulkText)])
              setBulkText('')
              setBulkMode(false)
            }}
          >
            Add to list
          </button>
        </div>
      )}
    </div>
  )
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

function appBaseUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '')
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
