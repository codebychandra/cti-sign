import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { FieldType, Form, FormField, ProjectCustomField, TextAlign } from '../lib/types'
import { getPageCount, renderPage } from '../lib/pdf'
import { PageHeader } from '../components/Layout'

const RENDER_WIDTH = 720
const FIELD_TYPES: { type: FieldType; label: string; w: number; h: number }[] = [
  { type: 'signature', label: 'Signature', w: 0.26, h: 0.06 },
  { type: 'signed_date', label: 'Signed date', w: 0.18, h: 0.04 },
  { type: 'initials', label: 'Initials', w: 0.1, h: 0.05 },
  { type: 'text', label: 'Text', w: 0.26, h: 0.04 },
  { type: 'date', label: 'Date', w: 0.16, h: 0.04 },
  { type: 'number', label: 'Number', w: 0.16, h: 0.04 },
  { type: 'email', label: 'Email', w: 0.26, h: 0.04 },
]

const TEXT_ALIGN: TextAlign[] = ['left', 'center', 'right']

type LocalField = FormField & { _new?: boolean }
type FieldMetric = 'x' | 'y' | 'width' | 'height'

function defaultFontSize(type: FieldType) {
  return type === 'signature' || type === 'initials' ? 18 : 11
}

function normalizeField(field: LocalField): LocalField {
  const align = TEXT_ALIGN.includes(field.text_align) ? field.text_align : 'left'
  return {
    ...field,
    custom_field_id: field.custom_field_id ?? null,
    text_align: align,
    font_size: field.font_size ?? defaultFontSize(field.type),
  }
}

export function FormEditor() {
  const { formId } = useParams()
  const [form, setForm] = useState<Form | null>(null)
  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([])
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [fields, setFields] = useState<LocalField[]>([])
  const [tool, setTool] = useState<FieldType>('signature')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [preview, setPreview] = useState(false)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const selectedField = selectedIds.length === 1 ? fields.find((field) => field.id === selectedIds[0]) : null

  const load = useCallback(async () => {
    const { data: f } = await supabase.from('forms').select('*').eq('id', formId).single()
    const loadedForm = f as Form
    setForm(loadedForm)
    const [{ data: flds }, { data: projectFields }] = await Promise.all([
      supabase.from('form_fields').select('*').eq('form_id', formId).order('sort_order'),
      supabase.from('project_custom_fields').select('*').eq('project_id', loadedForm.project_id).order('sort_order').order('created_at'),
    ])
    setFields(((flds as LocalField[]) ?? []).map(normalizeField))
    setCustomFields((projectFields as ProjectCustomField[]) ?? [])
    if (loadedForm?.template_path) {
      const { data: file, error } = await supabase.storage.from('templates').download(loadedForm.template_path)
      if (!error && file) {
        const buf = await file.arrayBuffer()
        setPdfBytes(buf)
        setPageCount(await getPageCount(buf))
      }
    }
  }, [formId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (event.key === 'Escape') {
        setSelectedIds([])
        return
      }
      if (preview || !selectedIds.length) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeSelectedFields()
        return
      }

      const moveByKey: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      }
      const direction = moveByKey[event.key]
      if (!direction) return

      event.preventDefault()
      const step = event.shiftKey ? 0.01 : 0.002
      setFields((prev) => prev.map((field) => {
        if (!selectedIds.includes(field.id)) return field
        return normalizeField({
          ...field,
          x: clamp(field.x + direction[0] * step, 0, 1 - field.width),
          y: clamp(field.y + direction[1] * step, 0, 1 - field.height),
        })
      }))
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview, selectedIds, fields])

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !form) return
    setBusy(true)
    setStatus('Uploading template...')
    const buf = await file.arrayBuffer()
    const count = await getPageCount(buf)
    const path = `${form.id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('templates').upload(path, file, {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (error) {
      setStatus('Upload failed: ' + error.message)
      setBusy(false)
      return
    }
    await supabase.from('forms').update({ template_path: path, page_count: count }).eq('id', form.id)
    setPdfBytes(buf)
    setPageCount(count)
    setStatus('Template uploaded.')
    setBusy(false)
    load()
  }

  const selectField = (id: string, additive = false) => {
    setSelectedIds((prev) => {
      if (!additive) return [id]
      return prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]
    })
  }

  const addField = (page: number, nx: number, ny: number) => {
    const spec = FIELD_TYPES.find((t) => t.type === tool)!
    const id = crypto.randomUUID()
    const field: LocalField = {
      id,
      form_id: formId!,
      type: tool,
      label: spec.label,
      custom_field_id: null,
      page,
      x: Math.max(0, Math.min(1 - spec.w, nx - spec.w / 2)),
      y: Math.max(0, Math.min(1 - spec.h, ny - spec.h / 2)),
      width: spec.w,
      height: spec.h,
      text_align: 'left',
      font_size: defaultFontSize(tool),
      required: true,
      sort_order: fields.length,
      _new: true,
    }
    setFields((prev) => [...prev, field])
    setSelectedIds([id])
  }

  const updateField = (id: string, patch: Partial<LocalField>) =>
    setFields((prev) => prev.map((f) => (f.id === id ? normalizeField({ ...f, ...patch }) : f)))

  const updateSelectedFields = (patcher: (field: LocalField) => Partial<LocalField>) => {
    setFields((prev) => prev.map((field) => selectedIds.includes(field.id) ? normalizeField({ ...field, ...patcher(field) }) : field))
  }

  const moveField = (id: string, nx: number, ny: number) => {
    setFields((prev) => {
      const anchor = prev.find((field) => field.id === id)
      if (!anchor) return prev
      const activeIds = selectedIds.includes(id) && selectedIds.length > 1 ? selectedIds : [id]
      const dx = nx - anchor.x
      const dy = ny - anchor.y
      return prev.map((field) => {
        if (!activeIds.includes(field.id)) return field
        return normalizeField({
          ...field,
          x: clamp(field.x + dx, 0, 1 - field.width),
          y: clamp(field.y + dy, 0, 1 - field.height),
        })
      })
    })
  }

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
    setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id))
  }

  const removeSelectedFields = () => {
    setFields((prev) => prev.filter((field) => !selectedIds.includes(field.id)))
    setSelectedIds([])
  }

  const alignSelectedFields = (align: TextAlign) => {
    updateSelectedFields((field) => {
      if (align === 'left') return { x: 0, text_align: align }
      if (align === 'center') return { x: clamp((1 - field.width) / 2, 0, 1 - field.width), text_align: align }
      return { x: clamp(1 - field.width, 0, 1 - field.width), text_align: align }
    })
  }

  const fullWidthSelectedFields = () => {
    updateSelectedFields(() => ({ x: 0, width: 1 }))
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    setStatus('Saving field mapping...')
    await supabase.from('form_fields').delete().eq('form_id', form.id)
    if (fields.length) {
      const rows = fields.map(({ _new, ...f }, i) => ({ ...normalizeField(f), sort_order: i }))
      const { error } = await supabase.from('form_fields').insert(rows)
      if (error) {
        setStatus('Save failed: ' + error.message)
        setBusy(false)
        return
      }
    }
    setStatus(`Saved ${fields.length} field(s).`)
    setBusy(false)
  }

  if (!form) return <p className="text-cti-gray">Loading...</p>

  return (
    <>
      <PageHeader
        title={form.name}
        subtitle="Upload the template PDF, then drop signature fields and mapped record columns."
        actions={
          <div className="flex gap-2">
            <Link to={`/projects/${form.project_id}`} className="btn-ghost">Back</Link>
            <button className="btn-primary" onClick={save} disabled={busy || !pdfBytes}>Save mapping</button>
          </div>
        }
      />

      {!pdfBytes ? (
        <div className="card grid place-items-center gap-4 p-12 text-center">
          <p className="text-cti-gray">No template uploaded yet.</p>
          <label className="btn-primary cursor-pointer">
            Upload PDF template
            <input type="file" accept="application/pdf" className="hidden" onChange={onUpload} />
          </label>
          {status && <p className="text-sm text-cti-gray">{status}</p>}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="card p-4">
              <p className="label">Mode</p>
              <button type="button" onClick={() => setPreview((value) => !value)} className={preview ? 'btn-primary w-full' : 'btn-ghost w-full'}>
                {preview ? 'Preview on' : 'Preview result'}
              </button>
              <p className="mt-2 text-xs text-cti-gray">
                {preview ? 'Showing dummy values so you can check alignment.' : 'Preview fills mapped fields with sample values.'}
              </p>

              <div className="mt-4 border-t border-cti-line pt-4">
                <p className="label">Field to place</p>
                <div className="grid grid-cols-2 gap-2">
                  {FIELD_TYPES.map((t) => (
                    <button key={t.type} onClick={() => setTool(t.type)} disabled={preview} className={`btn text-xs ${tool === t.type ? 'bg-cti-red text-white' : 'border border-cti-line bg-white text-cti-ink hover:bg-cti-bg'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-cti-gray">Use Text/Date/Number/Email fields for mapped record columns.</p>
              </div>

              <div className="mt-4 border-t border-cti-line pt-4">
                <p className="label">Short keys</p>
                <ul className="space-y-1 text-xs text-cti-gray">
                  <li><kbd className="rounded border border-cti-line px-1">Ctrl</kbd>/<kbd className="rounded border border-cti-line px-1">Cmd</kbd> + click: multi-select</li>
                  <li><kbd className="rounded border border-cti-line px-1">Shift</kbd> + click: add/remove field</li>
                  <li><kbd className="rounded border border-cti-line px-1">Arrow</kbd>: move selected</li>
                  <li><kbd className="rounded border border-cti-line px-1">Shift</kbd> + arrow: move faster</li>
                  <li><kbd className="rounded border border-cti-line px-1">Delete</kbd>: delete selected</li>
                  <li><kbd className="rounded border border-cti-line px-1">Esc</kbd>: clear selection</li>
                </ul>
              </div>

              <label className="btn-ghost mt-4 w-full cursor-pointer text-xs">
                Replace template PDF
                <input type="file" accept="application/pdf" className="hidden" onChange={onUpload} />
              </label>

              {selectedField && !preview && (
                <FieldInspector
                  field={selectedField}
                  customFields={customFields}
                  onChange={(p) => updateField(selectedField.id, p)}
                  onDelete={() => removeField(selectedField.id)}
                />
              )}
              {selectedIds.length > 1 && !preview && (
                <MultiFieldInspector
                  count={selectedIds.length}
                  onAlign={alignSelectedFields}
                  onFullWidth={fullWidthSelectedFields}
                  onDelete={removeSelectedFields}
                />
              )}
              {status && <p className="mt-3 text-xs text-cti-gray">{status}</p>}
            </div>
          </aside>

          <div className="space-y-6">
            {Array.from({ length: pageCount }).map((_, i) => (
              <PageCanvas
                key={i}
                pdfBytes={pdfBytes}
                pageIndex={i}
                fields={fields.filter((f) => f.page === i)}
                customFields={customFields}
                selectedIds={selectedIds}
                preview={preview}
                onAdd={(nx, ny) => addField(i, nx, ny)}
                onSelect={selectField}
                onMove={moveField}
                onResize={(id, w, h) => updateField(id, { width: w, height: h })}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function FieldInspector({ field, customFields, onChange, onDelete }: { field: LocalField; customFields: ProjectCustomField[]; onChange: (p: Partial<LocalField>) => void; onDelete: () => void }) {
  const setMetric = (key: FieldMetric, raw: string) => {
    const next = Number(raw)
    if (!Number.isFinite(next)) return
    const value = next / 100
    const max = key === 'x' ? 1 - field.width : key === 'y' ? 1 - field.height : key === 'width' ? 1 - field.x : 1 - field.y
    const min = key === 'width' ? 0.03 : key === 'height' ? 0.02 : 0
    onChange({ [key]: clamp(value, min, max) } as Partial<LocalField>)
  }
  const alignField = (align: TextAlign) => {
    if (align === 'left') onChange({ x: 0 })
    if (align === 'center') onChange({ x: clamp((1 - field.width) / 2, 0, 1 - field.width) })
    if (align === 'right') onChange({ x: clamp(1 - field.width, 0, 1 - field.width) })
  }
  const fontSize = field.font_size ?? defaultFontSize(field.type)
  const canMapCustom = !['signature', 'initials', 'signed_date'].includes(field.type)

  return (
    <div className="mt-4 border-t border-cti-line pt-4">
      <p className="label">Selected: {field.type === 'signed_date' ? 'signed date' : field.type}</p>
      <label className="label mt-2">Label</label>
      <input className="input" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />

      {canMapCustom && (
        <div className="mt-3">
          <label className="label">Mapped record column</label>
          <select
            className="input"
            value={field.custom_field_id ?? ''}
            onChange={(e) => {
              const match = customFields.find((customField) => customField.id === e.target.value)
              onChange({ custom_field_id: e.target.value || null, label: match?.label ?? field.label })
            }}
          >
            <option value="">Signer/manual field</option>
            {customFields.map((customField) => <option key={customField.id} value={customField.id}>{customField.label}</option>)}
          </select>
        </div>
      )}

      <div className="mt-4 border-t border-cti-line pt-4">
        <p className="label">Field position</p>
        <div className="grid grid-cols-2 gap-2">
          <MetricInput label="X" value={field.x} onChange={(value) => setMetric('x', value)} />
          <MetricInput label="Y" value={field.y} onChange={(value) => setMetric('y', value)} />
          <MetricInput label="W" value={field.width} onChange={(value) => setMetric('width', value)} />
          <MetricInput label="H" value={field.height} onChange={(value) => setMetric('height', value)} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {TEXT_ALIGN.map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => alignField(align)}>{align}</button>)}
        </div>
        <button type="button" className="btn-ghost mt-2 w-full px-2 py-1 text-xs" onClick={() => onChange({ x: 0, width: 1 })}>Full width</button>
      </div>

      <div className="mt-4 border-t border-cti-line pt-4">
        <p className="label">Text style</p>
        <label className="label mt-2">Text align</label>
        <select className="input" value={field.text_align ?? 'left'} onChange={(e) => onChange({ text_align: e.target.value as TextAlign })}>
          {TEXT_ALIGN.map((align) => <option key={align} value={align}>{align}</option>)}
        </select>
        <label className="label mt-2">Text size</label>
        <div className="flex items-center gap-2">
          <input className="input" type="number" min={6} max={72} step={1} value={fontSize} onChange={(e) => onChange({ font_size: clamp(Number(e.target.value) || defaultFontSize(field.type), 6, 72) })} />
          <span className="text-xs text-cti-gray">pt</span>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
        Required
      </label>
      <button className="btn-ghost mt-3 w-full text-cti-red" onClick={onDelete}>Delete field</button>
    </div>
  )
}

function MultiFieldInspector({ count, onAlign, onFullWidth, onDelete }: { count: number; onAlign: (align: TextAlign) => void; onFullWidth: () => void; onDelete: () => void }) {
  return (
    <div className="mt-4 border-t border-cti-line pt-4">
      <p className="label">Selected: {count} fields</p>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {TEXT_ALIGN.map((align) => <button key={align} type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => onAlign(align)}>{align}</button>)}
      </div>
      <button type="button" className="btn-ghost mt-2 w-full px-2 py-1 text-xs" onClick={onFullWidth}>Full width</button>
      <button className="btn-ghost mt-3 w-full text-cti-red" onClick={onDelete}>Delete selected</button>
    </div>
  )
}

function MetricInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  return (
    <label className="text-xs text-cti-gray">
      {label}
      <input className="input mt-1 px-2 py-1 text-xs" type="number" min={0} max={100} step={0.1} value={Number((value * 100).toFixed(1))} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function PageCanvas({ pdfBytes, pageIndex, fields, customFields, selectedIds, preview, onAdd, onSelect, onMove, onResize }: { pdfBytes: ArrayBuffer; pageIndex: number; fields: LocalField[]; customFields: ProjectCustomField[]; selectedIds: string[]; preview: boolean; onAdd: (nx: number, ny: number) => void; onSelect: (id: string, additive?: boolean) => void; onMove: (id: string, nx: number, ny: number) => void; onResize: (id: string, w: number, h: number) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: RENDER_WIDTH, h: RENDER_WIDTH * 1.3 })
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    renderPage(pdfBytes, pageIndex, c, RENDER_WIDTH).then((dim) => setSize({ w: dim.width, h: dim.height }))
  }, [pdfBytes, pageIndex])

  const handleClick = (e: React.MouseEvent) => {
    if (preview || drag.current || (e.target as HTMLElement).dataset.field) return
    const rect = wrapRef.current!.getBoundingClientRect()
    onAdd((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (preview || !drag.current) return
    const rect = wrapRef.current!.getBoundingClientRect()
    const dx = (e.clientX - drag.current.sx) / rect.width
    const dy = (e.clientY - drag.current.sy) / rect.height
    const f = fields.find((x) => x.id === drag.current!.id)
    if (!f) return
    if (drag.current.mode === 'move') onMove(f.id, clamp(drag.current.ox + dx, 0, 1 - f.width), clamp(drag.current.oy + dy, 0, 1 - f.height))
    else onResize(f.id, clamp(drag.current.ox + dx, 0.03, 1 - f.x), clamp(drag.current.oy + dy, 0.02, 1 - f.y))
  }
  const endDrag = () => (drag.current = null)

  return (
    <div className="card inline-block overflow-hidden p-0">
      <div ref={wrapRef} className={`relative ${preview ? 'cursor-default' : 'cursor-crosshair'}`} style={{ width: size.w, height: size.h }} onClick={handleClick} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
        <canvas ref={canvasRef} className="block" />
        {fields.map((f) => {
          const align = f.text_align ?? 'left'
          const justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'
          const isSelected = selectedIds.includes(f.id)
          return (
            <div
              key={f.id}
              data-field="1"
              onPointerDown={(e) => {
                if (preview) return
                e.stopPropagation()
                const additive = e.ctrlKey || e.metaKey || e.shiftKey
                const keepGroupSelection = isSelected && selectedIds.length > 1 && !additive
                if (!keepGroupSelection) onSelect(f.id, additive)
                drag.current = { id: f.id, mode: 'move', sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y }
                ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              }}
              className={`absolute flex items-center rounded text-[10px] font-semibold ${isSelected && !preview ? 'ring-2 ring-cti-red ring-offset-1' : ''} ${preview ? 'overflow-hidden px-1 normal-case tracking-normal' : 'justify-center uppercase tracking-wide'}`}
              style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%`, background: preview ? 'rgba(255,255,255,0.08)' : isSelected ? 'rgba(225,27,34,0.18)' : 'rgba(225,27,34,0.12)', border: preview ? '1px solid rgba(22,163,74,0.7)' : '1px dashed #E11B22', color: preview ? '#111111' : '#B3151B', fontFamily: f.type === 'signature' || f.type === 'initials' ? 'cursive' : 'Arial, sans-serif', fontSize: preview ? `${f.font_size ?? defaultFontSize(f.type)}px` : undefined, justifyContent: preview ? justifyContent : undefined, lineHeight: preview ? '1.1' : undefined, textAlign: align }}
            >
              {preview ? sampleValue(f, customFields) : f.custom_field_id ? customFields.find((field) => field.id === f.custom_field_id)?.label ?? fieldLabel(f.type) : fieldLabel(f.type)}
              {!preview && <span data-field="1" onPointerDown={(e) => { e.stopPropagation(); onSelect(f.id); drag.current = { id: f.id, mode: 'resize', sx: e.clientX, sy: e.clientY, ox: f.width, oy: f.height }; (e.target as HTMLElement).setPointerCapture(e.pointerId) }} className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-cti-red" />}
            </div>
          )
        })}
      </div>
    </div>
  )
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
  return type === 'signed_date' ? 'signed date' : type
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
