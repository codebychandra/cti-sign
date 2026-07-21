import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { CustomFieldType, FieldType, Form, FormField, ProjectCustomField, TextAlign } from '../lib/types'
import { detectFormFields, getPageCount, renderPage, type DetectedField } from '../lib/pdf'
import { PageHeader } from '../components/Layout'

const RENDER_WIDTH = 720
const FIELD_TYPES: { type: FieldType; label: string; w: number; h: number }[] = [
  { type: 'signature', label: 'Signature', w: 0.26, h: 0.06 },
  { type: 'signed_date', label: 'Signed date', w: 0.18, h: 0.04 },
  { type: 'initials', label: 'Initials', w: 0.1, h: 0.05 },
  { type: 'text', label: 'Text', w: 0.26, h: 0.04 },
  { type: 'textarea', label: 'Text area', w: 0.34, h: 0.11 },
  { type: 'date', label: 'Date', w: 0.16, h: 0.04 },
  { type: 'number', label: 'Number', w: 0.16, h: 0.04 },
  { type: 'email', label: 'Email', w: 0.26, h: 0.04 },
]

const TEXT_ALIGN: TextAlign[] = ['left', 'center', 'right']
type LocalField = FormField & { _new?: boolean }
type FieldMetric = 'x' | 'y' | 'width' | 'height'
type VerticalAlign = 'top' | 'middle' | 'bottom'

function defaultFontSize(type: FieldType) {
  return type === 'signature' || type === 'initials' ? 18 : 11
}

// When a template field gets mapped to a project custom field, its own
// input type should follow suit — otherwise a field mapped to a Date column
// keeps rendering as a plain text box for the signer instead of a date picker.
function typeForCustomFieldType(customType: CustomFieldType): FieldType | null {
  if (customType === 'date') return 'date'
  if (customType === 'number') return 'number'
  if (customType === 'email') return 'email'
  return null
}

function normalizeField(field: LocalField): LocalField {
  const align = TEXT_ALIGN.includes(field.text_align) ? field.text_align : 'left'
  return { ...field, custom_field_id: field.custom_field_id ?? null, text_align: align, font_size: field.font_size ?? defaultFontSize(field.type) }
}

function detectedToLocalFields(detected: DetectedField[], startIndex: number): LocalField[] {
  return detected.map((d, i) => ({
    id: crypto.randomUUID(),
    type: d.type,
    label: d.name || `Field ${startIndex + i + 1}`,
    custom_field_id: null,
    page: d.page,
    x: clamp(d.x, 0, 1 - d.width),
    y: clamp(d.y, 0, 1 - d.height),
    width: Math.max(0.03, d.width),
    height: Math.max(0.02, d.height),
    text_align: 'left',
    font_size: defaultFontSize(d.type),
    required: true,
    sort_order: startIndex + i,
    _new: true,
  }))
}

export function FormEditor() {
  const { formId } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState<Form | null>(null)
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [fields, setFields] = useState<LocalField[]>([])
  const [history, setHistory] = useState<LocalField[][]>([])
  const [future, setFuture] = useState<LocalField[][]>([])
  const [copiedFields, setCopiedFields] = useState<LocalField[]>([])
  const [tool, setTool] = useState<FieldType>('signature')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [detectedFields, setDetectedFields] = useState<DetectedField[]>([])
  const [dirty, setDirty] = useState(false)
  const savedFieldsSnapshotRef = useRef<string>('[]')
  const selectedField = selectedIds.length === 1 ? fields.find((field) => field.id === selectedIds[0]) : null

  const load = useCallback(async () => {
    const loadedForm = await api.get<Form>('forms', formId!)
    setForm(loadedForm)
    const projectFields = await api.list<ProjectCustomField>('custom-fields', { project_id: loadedForm.project_id })
    const loadedFields = ((loadedForm.fields as LocalField[]) ?? []).map(normalizeField)
    setFields(loadedFields)
    savedFieldsSnapshotRef.current = JSON.stringify(loadedFields)
    setDirty(false)
    setHistory([])
    setFuture([])
    setCustomFields(projectFields.sort((a, b) => a.sort_order - b.sort_order))
    if (loadedForm.has_template) {
      const { base64 } = await api.getTemplate(loadedForm.id)
      const buf = base64ToArrayBuffer(base64)
      setPdfBytes(buf)
      setPageCount(await getPageCount(buf))
    }
  }, [formId])

  useEffect(() => { load() }, [load])

  // Detects ANY change to `fields` (drag, resize, insert, undo/redo, mapping,
  // delete...) by comparing against the last-loaded-or-saved snapshot, so we
  // can warn before that work is lost — detected/inserted fields only exist
  // in the browser until "Save mapping" is clicked.
  useEffect(() => {
    const current = JSON.stringify(fields.map(({ _new, ...f }) => f))
    setDirty(current !== savedFieldsSnapshotRef.current)
  }, [fields])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-39), fields])
    setFuture([])
  }, [fields])

  const setFieldsWithHistory = (updater: (prev: LocalField[]) => LocalField[]) => {
    pushHistory()
    setFields(updater)
  }

  const undo = () => {
    setHistory((prev) => {
      if (!prev.length) return prev
      const previous = prev[prev.length - 1]
      setFuture((items) => [fields, ...items].slice(0, 40))
      setFields(previous)
      setSelectedIds((ids) => ids.filter((id) => previous.some((field) => field.id === id)))
      return prev.slice(0, -1)
    })
  }

  const redo = () => {
    setFuture((prev) => {
      if (!prev.length) return prev
      const next = prev[0]
      setHistory((items) => [...items.slice(-39), fields])
      setFields(next)
      setSelectedIds((ids) => ids.filter((id) => next.some((field) => field.id === id)))
      return prev.slice(1)
    })
  }

  const copyFields = () => {
    const selected = fields.filter((field) => selectedIds.includes(field.id))
    setCopiedFields(selected.map((field) => ({ ...field })))
  }

  const pasteFields = () => {
    if (!copiedFields.length) return
    setFieldsWithHistory((prev) => {
      const pasted = copiedFields.map((field, index) => ({
        ...field,
        id: crypto.randomUUID(),
        x: clamp(field.x + 0.025 + index * 0.005, 0, 1 - field.width),
        y: clamp(field.y + 0.025 + index * 0.005, 0, 1 - field.height),
        sort_order: prev.length + index,
        _new: true,
      }))
      setSelectedIds(pasted.map((field) => field.id))
      return [...prev, ...pasted]
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'c') { event.preventDefault(); copyFields(); return }
      if ((event.ctrlKey || event.metaKey) && key === 'v') { event.preventDefault(); pasteFields(); return }
      if ((event.ctrlKey || event.metaKey) && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
      if ((event.ctrlKey || event.metaKey) && key === 'y') { event.preventDefault(); redo(); return }
      if (event.key === 'Escape') { setSelectedIds([]); return }
      if (preview || !selectedIds.length) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelectedFields(); return }
      const moveByKey: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const direction = moveByKey[event.key]
      if (!direction) return
      event.preventDefault()
      const step = event.shiftKey ? 0.01 : 0.002
      setFieldsWithHistory((prev) => prev.map((field) => selectedIds.includes(field.id) ? normalizeField({ ...field, x: clamp(field.x + direction[0] * step, 0, 1 - field.width), y: clamp(field.y + direction[1] * step, 0, 1 - field.height) }) : field))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview, selectedIds, fields, copiedFields, history, future])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !form) return
    setBusy(true)
    setStatus('Uploading template...')
    const buf = await file.arrayBuffer()
    const count = await getPageCount(buf)
    try {
      await api.uploadTemplate(form.id, arrayBufferToBase64(buf), count)
    } catch (e) {
      setStatus('Upload failed: ' + (e as Error).message)
      setBusy(false)
      return
    }
    setPdfBytes(buf)
    setPageCount(count)

    let detected: DetectedField[] = []
    try {
      detected = await detectFormFields(buf)
    } catch {
      detected = []
    }

    if (!detected.length) {
      setStatus('Template uploaded. No fillable fields detected — place fields manually.')
    } else if (fields.length === 0) {
      setFieldsWithHistory(() => detectedToLocalFields(detected, 0))
      setStatus(`Template uploaded. Detected and added ${detected.length} fillable field(s) — review each one's type and mapping, then click Save mapping.`)
    } else {
      setDetectedFields(detected)
      setStatus(`Template uploaded. Detected ${detected.length} fillable field(s) — click "Insert detected fields" to add them (existing fields kept as-is).`)
    }
    // Deliberately not calling load() here: the just-detected/inserted fields
    // only exist in local state until "Save mapping" is clicked. Reloading
    // from the server now would overwrite them with the server's still-empty
    // field list. Just patch the two form properties that actually changed.
    setForm((prev) => (prev ? { ...prev, page_count: count, has_template: true } : prev))
    setBusy(false)
  }

  const insertDetectedFields = () => {
    if (!detectedFields.length) return
    setFieldsWithHistory((prev) => [...prev, ...detectedToLocalFields(detectedFields, prev.length)])
    setDetectedFields([])
  }

  const selectField = (id: string, additive = false) => setSelectedIds((prev) => !additive ? [id] : prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id])

  const addField = (page: number, nx: number, ny: number) => {
    const spec = FIELD_TYPES.find((t) => t.type === tool)!
    const id = crypto.randomUUID()
    const field: LocalField = { id, type: tool, label: spec.label, custom_field_id: null, page, x: Math.max(0, Math.min(1 - spec.w, nx - spec.w / 2)), y: Math.max(0, Math.min(1 - spec.h, ny - spec.h / 2)), width: spec.w, height: spec.h, text_align: 'left', font_size: defaultFontSize(tool), required: true, sort_order: fields.length, _new: true }
    setFieldsWithHistory((prev) => [...prev, field])
    setSelectedIds([id])
  }

  const updateField = (id: string, patch: Partial<LocalField>) => setFieldsWithHistory((prev) => prev.map((f) => (f.id === id ? normalizeField({ ...f, ...patch }) : f)))
  const updateSelectedFields = (patcher: (field: LocalField) => Partial<LocalField>) => setFieldsWithHistory((prev) => prev.map((field) => selectedIds.includes(field.id) ? normalizeField({ ...field, ...patcher(field) }) : field))
  const mapFieldToCustom = (fieldId: string, customFieldId: string) => {
    const match = customFields.find((cf) => cf.id === customFieldId)
    const mappedType = match ? typeForCustomFieldType(match.type) : null
    updateField(fieldId, {
      custom_field_id: customFieldId || null,
      label: match?.label ?? fields.find((f) => f.id === fieldId)?.label ?? '',
      ...(mappedType ? { type: mappedType } : {}),
    })
  }

  const moveField = (id: string, nx: number, ny: number) => {
    setFields((prev) => {
      const anchor = prev.find((field) => field.id === id)
      if (!anchor) return prev
      const activeIds = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
      const dx = nx - anchor.x
      const dy = ny - anchor.y
      return prev.map((field) => activeIds.includes(field.id) ? normalizeField({ ...field, x: clamp(field.x + dx, 0, 1 - field.width), y: clamp(field.y + dy, 0, 1 - field.height) }) : field)
    })
  }

  const removeField = (id: string) => { setFieldsWithHistory((prev) => prev.filter((f) => f.id !== id)); setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id)) }
  const removeSelectedFields = () => { setFieldsWithHistory((prev) => prev.filter((field) => !selectedIds.includes(field.id))); setSelectedIds([]) }
  const alignSelectedFields = (align: TextAlign) => updateSelectedFields((field) => align === 'left' ? { x: 0, text_align: align } : align === 'center' ? { x: clamp((1 - field.width) / 2, 0, 1 - field.width), text_align: align } : { x: clamp(1 - field.width, 0, 1 - field.width), text_align: align })
  const verticalAlignSelectedFields = (align: VerticalAlign) => updateSelectedFields((field) => align === 'top' ? { y: 0 } : align === 'middle' ? { y: clamp((1 - field.height) / 2, 0, 1 - field.height) } : { y: clamp(1 - field.height, 0, 1 - field.height) })
  const fullWidthSelectedFields = () => updateSelectedFields(() => ({ x: 0, width: 1 }))

  const save = async () => {
    if (!form) return
    setBusy(true)
    setStatus('Saving field mapping...')
    const rows = fields.map(({ _new, ...f }, i) => ({ ...normalizeField(f as LocalField), sort_order: i }))
    try {
      await api.replaceFields(form.id, rows)
    } catch (e) {
      setStatus('Save failed: ' + (e as Error).message)
      setBusy(false)
      return
    }
    setStatus(`Saved ${fields.length} field(s).`)
    setBusy(false)
    load()
  }

  if (!form) return <p className="text-cti-gray">Loading...</p>

  return <>
    <PageHeader
      title={form.name}
      subtitle="Upload the template PDF, then drop signature fields and mapped record columns."
      actions={
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs font-semibold text-cti-red">Unsaved changes</span>}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (dirty && !window.confirm('You have unsaved field changes that will be lost. Leave anyway?')) return
              navigate(`/projects/${form.project_id}`)
            }}
          >
            Back
          </button>
          <button className="btn-primary" onClick={save} disabled={busy || !pdfBytes}>Save mapping</button>
        </div>
      }
    />
    {!pdfBytes ? <div className="card grid place-items-center gap-4 p-12 text-center"><p className="text-cti-gray">No template uploaded yet.</p><label className="btn-primary cursor-pointer">Upload PDF template<input type="file" accept="application/pdf" className="hidden" onChange={onUpload} /></label>{status && <p className="text-sm text-cti-gray">{status}</p>}</div> : (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-6">{Array.from({ length: pageCount }).map((_, i) => <PageCanvas key={i} pdfBytes={pdfBytes} pageIndex={i} fields={fields.filter((f) => f.page === i)} customFields={customFields} selectedIds={selectedIds} preview={preview} onAdd={(nx, ny) => addField(i, nx, ny)} onSelect={selectField} onMove={moveField} onResize={(id, w, h) => setFields((prev) => prev.map((field) => field.id === id ? normalizeField({ ...field, width: w, height: h }) : field))} onCommitHistory={pushHistory} />)}</div>
        <aside className="lg:sticky lg:top-20 lg:self-start"><div className="card p-4">
          <p className="label">Mode</p><button type="button" onClick={() => setPreview((value) => !value)} className={preview ? 'btn-primary w-full' : 'btn-ghost w-full'}>{preview ? 'Preview on' : 'Preview result'}</button><p className="mt-2 text-xs text-cti-gray">{preview ? 'Showing dummy values so you can check alignment.' : 'Preview fills mapped fields with sample values.'}</p>
          <div className="mt-4 border-t border-cti-line pt-4"><p className="label">Edit</p><div className="grid grid-cols-2 gap-2"><button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={undo} disabled={!history.length}>Undo</button><button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={redo} disabled={!future.length}>Redo</button><button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={copyFields} disabled={!selectedIds.length}>Copy</button><button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={pasteFields} disabled={!copiedFields.length}>Paste</button></div></div>
          <div className="mt-4 border-t border-cti-line pt-4"><p className="label">Field to place</p><div className="grid grid-cols-2 gap-2">{FIELD_TYPES.map((t) => <button key={t.type} onClick={() => setTool(t.type)} disabled={preview} className={`btn text-xs ${tool === t.type ? 'bg-cti-red text-white' : 'border border-cti-line bg-white text-cti-ink hover:bg-cti-bg'}`}>{t.label}</button>)}</div><p className="mt-3 text-xs text-cti-gray">Use Text/Date/Number/Email/Text area fields for mapped record columns.</p></div>
          <label className="btn-ghost mt-4 w-full cursor-pointer text-xs">Replace template PDF<input type="file" accept="application/pdf" className="hidden" onChange={onUpload} /></label>
          {detectedFields.length > 0 && <button type="button" className="btn-primary mt-2 w-full text-xs" onClick={insertDetectedFields}>Insert {detectedFields.length} detected field(s)</button>}
          {selectedField && !preview && <FieldInspector field={selectedField} customFields={customFields} onChange={(p) => updateField(selectedField.id, p)} onDelete={() => removeField(selectedField.id)} />}
          {selectedIds.length > 1 && !preview && <MultiFieldInspector count={selectedIds.length} onAlign={alignSelectedFields} onVerticalAlign={verticalAlignSelectedFields} onFullWidth={fullWidthSelectedFields} onDelete={removeSelectedFields} />}
          {status && <p className="mt-3 text-xs text-cti-gray">{status}</p>}
        </div></aside>
      </div>
    )}
    {pdfBytes && <FieldMappingList fields={fields} customFields={customFields} onMap={mapFieldToCustom} />}
  </>
}

function FieldMappingList({ fields, customFields, onMap }: { fields: LocalField[]; customFields: ProjectCustomField[]; onMap: (fieldId: string, customFieldId: string) => void }) {
  const mappable = fields.filter((f) => !['signature', 'initials'].includes(f.type)).sort((a, b) => a.sort_order - b.sort_order)
  if (!mappable.length) return null
  return (
    <div className="card mt-6 p-5">
      <h2 className="font-heading text-base font-bold text-cti-black">Map fields to record columns</h2>
      <p className="mt-1 text-sm text-cti-gray">
        Each number here matches the number badge on the same field on the PDF above. Pick which record column
        auto-fills each one — the rest stay blank for the signer or auto-populate to type in.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {mappable.map((f) => (
          <div key={f.id} className="flex items-center gap-2 rounded-md border border-cti-line p-2">
            <span className="w-12 shrink-0 text-xs font-semibold text-cti-gray">#{f.sort_order + 1}</span>
            <select className="input py-1 text-xs" value={f.custom_field_id ?? ''} onChange={(e) => onMap(f.id, e.target.value)}>
              <option value="">Signer/manual field</option>
              {customFields.map((cf) => <option key={cf.id} value={cf.id}>{cf.label}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

function FieldInspector({ field, customFields, onChange, onDelete }: { field: LocalField; customFields: ProjectCustomField[]; onChange: (p: Partial<LocalField>) => void; onDelete: () => void }) {
  const setMetric = (key: FieldMetric, raw: string) => { const next = Number(raw); if (!Number.isFinite(next)) return; const value = next / 100; const max = key === 'x' ? 1 - field.width : key === 'y' ? 1 - field.height : key === 'width' ? 1 - field.x : 1 - field.y; const min = key === 'width' ? 0.03 : key === 'height' ? 0.02 : 0; onChange({ [key]: clamp(value, min, max) } as Partial<LocalField>) }
  const alignField = (align: TextAlign) => { if (align === 'left') onChange({ x: 0, text_align: align }); if (align === 'center') onChange({ x: clamp((1 - field.width) / 2, 0, 1 - field.width), text_align: align }); if (align === 'right') onChange({ x: clamp(1 - field.width, 0, 1 - field.width), text_align: align }) }
  const alignFieldVertical = (align: VerticalAlign) => { if (align === 'top') onChange({ y: 0 }); if (align === 'middle') onChange({ y: clamp((1 - field.height) / 2, 0, 1 - field.height) }); if (align === 'bottom') onChange({ y: clamp(1 - field.height, 0, 1 - field.height) }) }
  const fontSize = field.font_size ?? defaultFontSize(field.type)
  const canMapCustom = !['signature', 'initials'].includes(field.type)
  return <div className="mt-4 border-t border-cti-line pt-4"><p className="label">Selected: {fieldLabel(field.type)}</p><label className="label mt-2">Label</label><input className="input" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />{canMapCustom && <div className="mt-3"><label className="label">Mapped record column</label><select className="input" value={field.custom_field_id ?? ''} onChange={(e) => { const match = customFields.find((customField) => customField.id === e.target.value); const mappedType = match ? typeForCustomFieldType(match.type) : null; onChange({ custom_field_id: e.target.value || null, label: match?.label ?? field.label, ...(mappedType ? { type: mappedType } : {}) }) }}><option value="">Signer/manual field</option>{customFields.map((customField) => <option key={customField.id} value={customField.id}>{customField.label}</option>)}</select></div>}<div className="mt-4 border-t border-cti-line pt-4"><p className="label">Field position</p><div className="grid grid-cols-2 gap-2"><MetricInput label="X" value={field.x} onChange={(value) => setMetric('x', value)} /><MetricInput label="Y" value={field.y} onChange={(value) => setMetric('y', value)} /><MetricInput label="W" value={field.width} onChange={(value) => setMetric('width', value)} /><MetricInput label="H" value={field.height} onChange={(value) => setMetric('height', value)} /></div><div className="mt-2 grid grid-cols-3 gap-1">{TEXT_ALIGN.map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => alignField(align)}>{align}</button>)}</div><div className="mt-2 grid grid-cols-3 gap-1">{(['top', 'middle', 'bottom'] as VerticalAlign[]).map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => alignFieldVertical(align)}>{align}</button>)}</div><button type="button" className="btn-ghost mt-2 w-full px-2 py-1 text-xs" onClick={() => onChange({ x: 0, width: 1 })}>Full width</button></div><div className="mt-4 border-t border-cti-line pt-4"><p className="label">Text style</p><label className="label mt-2">Text align</label><select className="input" value={field.text_align ?? 'left'} onChange={(e) => onChange({ text_align: e.target.value as TextAlign })}>{TEXT_ALIGN.map((align) => <option key={align} value={align}>{align}</option>)}</select><label className="label mt-2">Text size</label><div className="flex items-center gap-2"><input className="input" type="number" min={6} max={72} step={1} value={fontSize} onChange={(e) => onChange({ font_size: clamp(Number(e.target.value) || defaultFontSize(field.type), 6, 72) })} /><span className="text-xs text-cti-gray">pt</span></div></div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />Required</label><button className="btn-ghost mt-3 w-full text-cti-red" onClick={onDelete}>Delete field</button></div>
}

function MultiFieldInspector({ count, onAlign, onVerticalAlign, onFullWidth, onDelete }: { count: number; onAlign: (align: TextAlign) => void; onVerticalAlign: (align: VerticalAlign) => void; onFullWidth: () => void; onDelete: () => void }) {
  return <div className="mt-4 border-t border-cti-line pt-4"><p className="label">Selected: {count} fields</p><div className="mt-2 grid grid-cols-3 gap-1">{TEXT_ALIGN.map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onAlign(align)}>{align}</button>)}</div><div className="mt-2 grid grid-cols-3 gap-1">{(['top', 'middle', 'bottom'] as VerticalAlign[]).map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onVerticalAlign(align)}>{align}</button>)}</div><button type="button" className="btn-ghost mt-2 w-full px-2 py-1 text-xs" onClick={onFullWidth}>Full width</button><button className="btn-ghost mt-3 w-full text-cti-red" onClick={onDelete}>Delete selected</button></div>
}

function MetricInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return <label className="text-xs text-cti-gray">{label}<input className="input mt-1 px-2 py-1 text-xs" type="number" min={0} max={100} step={0.1} value={Number((value * 100).toFixed(1))} onChange={(e) => onChange(e.target.value)} /></label>
}

function PageCanvas({ pdfBytes, pageIndex, fields, customFields, selectedIds, preview, onAdd, onSelect, onMove, onResize, onCommitHistory }: { pdfBytes: ArrayBuffer; pageIndex: number; fields: LocalField[]; customFields: ProjectCustomField[]; selectedIds: string[]; preview: boolean; onAdd: (nx: number, ny: number) => void; onSelect: (id: string, additive?: boolean) => void; onMove: (id: string, nx: number, ny: number) => void; onResize: (id: string, w: number, h: number) => void; onCommitHistory: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: RENDER_WIDTH, h: RENDER_WIDTH * 1.3 })
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number } | null>(null)
  useEffect(() => { const c = canvasRef.current; if (!c) return; renderPage(pdfBytes, pageIndex, c, RENDER_WIDTH).then((dim) => setSize({ w: dim.width, h: dim.height })) }, [pdfBytes, pageIndex])
  const handleClick = (e: React.MouseEvent) => { if (preview || drag.current || (e.target as HTMLElement).dataset.field) return; const rect = wrapRef.current!.getBoundingClientRect(); onAdd((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height) }
  const onPointerMove = (e: React.PointerEvent) => { if (preview || !drag.current) return; const rect = wrapRef.current!.getBoundingClientRect(); const dx = (e.clientX - drag.current.sx) / rect.width; const dy = (e.clientY - drag.current.sy) / rect.height; const f = fields.find((x) => x.id === drag.current!.id); if (!f) return; if (drag.current.mode === 'move') onMove(f.id, clamp(drag.current.ox + dx, 0, 1 - f.width), clamp(drag.current.oy + dy, 0, 1 - f.height)); else onResize(f.id, clamp(drag.current.ox + dx, 0.03, 1 - f.x), clamp(drag.current.oy + dy, 0.02, 1 - f.y)) }
  const endDrag = () => (drag.current = null)
  return <div className="card inline-block overflow-hidden p-0"><div ref={wrapRef} className={`relative ${preview ? 'cursor-default' : 'cursor-crosshair'}`} style={{ width: size.w, height: size.h }} onClick={handleClick} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}><canvas ref={canvasRef} className="block" />{fields.map((f) => { const align = f.text_align ?? 'left'; const justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'; const isSelected = selectedIds.includes(f.id); return <div key={f.id} data-field="1" onPointerDown={(e) => { if (preview) return; e.stopPropagation(); const additive = e.ctrlKey || e.metaKey || e.shiftKey; const keepGroupSelection = isSelected && selectedIds.length > 1 && !additive; if (!keepGroupSelection) onSelect(f.id, additive); onCommitHistory(); drag.current = { id: f.id, mode: 'move', sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId) }} className={`absolute flex items-center rounded text-[10px] font-semibold ${isSelected && !preview ? 'ring-2 ring-cti-red ring-offset-1' : ''} ${preview ? 'overflow-hidden px-1 normal-case tracking-normal whitespace-pre-wrap' : 'justify-center uppercase tracking-wide'}`} style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, background: preview ? 'rgba(255,255,255,0.08)' : isSelected ? 'rgba(225,27,34,0.18)' : 'rgba(225,27,34,0.12)', border: preview ? '1px solid rgba(22,163,74,0.7)' : '1px dashed #E11B22', color: preview ? '#111111' : '#B3151B', fontFamily: f.type === 'signature' || f.type === 'initials' ? 'cursive' : 'Arial, sans-serif', fontSize: preview ? `${f.font_size ?? defaultFontSize(f.type)}px` : undefined, justifyContent: preview ? justifyContent : undefined, alignItems: preview && f.type === 'textarea' ? 'flex-start' : undefined, lineHeight: preview ? '1.2' : undefined, textAlign: align }}>{preview ? sampleValue(f, customFields) : f.custom_field_id ? customFields.find((field) => field.id === f.custom_field_id)?.label ?? fieldLabel(f.type) : `#${f.sort_order + 1} ${fieldLabel(f.type)}`}{!preview && <span data-field="1" onPointerDown={(e) => { e.stopPropagation(); onSelect(f.id); onCommitHistory(); drag.current = { id: f.id, mode: 'resize', sx: e.clientX, sy: e.clientY, ox: f.width, oy: f.height }; (e.target as HTMLElement).setPointerCapture(e.pointerId) }} className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-cti-red" />}</div> })}</div></div>
}

function sampleValue(field: FormField, customFields: ProjectCustomField[]) {
  const mapped = customFields.find((customField) => customField.id === field.custom_field_id)
  if (mapped) return sampleCustomValue(mapped)
  const label = field.label.toLowerCase()
  if (field.type === 'signature') return 'Agus Chandra'
  if (field.type === 'initials') return 'AC'
  if (field.type === 'signed_date') return '2026-07-16'
  if (field.type === 'date') return '2026-07-16'
  if (field.type === 'number') return '12345'
  if (field.type === 'email') return 'cti-it-team@cti-usa.com'
  if (field.type === 'textarea') return 'Line one sample\nLine two sample\nLine three sample'
  if (label.includes('passport')) return 'A1234567'
  if (label.includes('seafarer') || label === 'id') return 'SF-10294'
  if (label.includes('position') || label.includes('posisi')) return 'Chief Engineer'
  if (label.includes('lamp')) return '-'
  if (label.includes('no')) return '001/CTI/ESIGN/VII/2026'
  return field.label && field.label !== 'Text' ? field.label : 'Sample text'
}

function sampleCustomValue(field: ProjectCustomField) {
  const label = field.label.toLowerCase()
  if (field.type === 'date') return '2026-07-16'
  if (field.type === 'email') return 'crew@example.com'
  if (field.type === 'number') return '12345'
  if (field.type === 'auto_number') return `${field.auto_prefix ?? ''}${field.auto_start ?? 1}`
  if (label.includes('passport')) return 'A1234567'
  if (label.includes('seafarer') || label === 'id') return 'SF-10294'
  if (label.includes('position') || label.includes('posisi')) return 'Chief Engineer'
  if (label.includes('name') || label.includes('nama')) return 'Agus Chandra'
  return field.label
}

function fieldLabel(type: FieldType) {
  if (type === 'signed_date') return 'signed date'
  if (type === 'textarea') return 'text area'
  return type
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}
