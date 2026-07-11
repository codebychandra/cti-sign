import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { FieldType, Form, FormField } from '../lib/types'
import { getPageCount, renderPage } from '../lib/pdf'
import { PageHeader } from '../components/Layout'

const RENDER_WIDTH = 720
const FIELD_TYPES: { type: FieldType; label: string; w: number; h: number }[] = [
  { type: 'signature', label: 'Signature', w: 0.26, h: 0.06 },
  { type: 'initials', label: 'Initials', w: 0.1, h: 0.05 },
  { type: 'name', label: 'Full name', w: 0.26, h: 0.04 },
  { type: 'date', label: 'Date', w: 0.16, h: 0.04 },
  { type: 'email', label: 'Email', w: 0.26, h: 0.04 },
  { type: 'text', label: 'Text', w: 0.26, h: 0.04 },
]

type LocalField = FormField & { _new?: boolean }

export function FormEditor() {
  const { formId } = useParams()
  const [form, setForm] = useState<Form | null>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [fields, setFields] = useState<LocalField[]>([])
  const [tool, setTool] = useState<FieldType>('signature')
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: f } = await supabase.from('forms').select('*').eq('id', formId).single()
    setForm(f as Form)
    const { data: flds } = await supabase.from('form_fields').select('*').eq('form_id', formId).order('sort_order')
    setFields((flds as LocalField[]) ?? [])
    if ((f as Form)?.template_path) {
      const { data: file, error } = await supabase.storage.from('templates').download((f as Form).template_path!)
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

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !form) return
    setBusy(true)
    setStatus('Uploading template…')
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

  const addField = (page: number, nx: number, ny: number) => {
    const spec = FIELD_TYPES.find((t) => t.type === tool)!
    const id = crypto.randomUUID()
    const field: LocalField = {
      id,
      form_id: formId!,
      type: tool,
      label: spec.label,
      page,
      x: Math.max(0, Math.min(1 - spec.w, nx - spec.w / 2)),
      y: Math.max(0, Math.min(1 - spec.h, ny - spec.h / 2)),
      width: spec.w,
      height: spec.h,
      required: true,
      sort_order: fields.length,
      _new: true,
    }
    setFields((prev) => [...prev, field])
    setSelected(id)
  }

  const updateField = (id: string, patch: Partial<LocalField>) =>
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)))

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id))
    if (selected === id) setSelected(null)
  }

  const save = async () => {
    if (!form) return
    setBusy(true)
    setStatus('Saving field mapping…')
    // replace-all strategy: delete existing, insert current
    await supabase.from('form_fields').delete().eq('form_id', form.id)
    if (fields.length) {
      const rows = fields.map(({ _new, ...f }, i) => ({ ...f, sort_order: i }))
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

  if (!form) return <p className="text-cti-gray">Loading…</p>

  return (
    <>
      <PageHeader
        title={form.name}
        subtitle="Upload the template PDF, then drop fields where they should be signed or filled."
        actions={
          <div className="flex gap-2">
            <Link to={`/projects/${form.project_id}`} className="btn-ghost">
              ← Back
            </Link>
            <button className="btn-primary" onClick={save} disabled={busy || !pdfBytes}>
              Save mapping
            </button>
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
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          {/* Toolbar */}
          <aside className="lg:sticky lg:top-20 lg:self-start">
            <div className="card p-4">
              <p className="label">Field to place</p>
              <div className="grid grid-cols-2 gap-2">
                {FIELD_TYPES.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => setTool(t.type)}
                    className={`btn text-xs ${tool === t.type ? 'bg-cti-red text-white' : 'border border-cti-line bg-white text-cti-ink hover:bg-cti-bg'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-cti-gray">
                Click on the page to drop a <b>{tool}</b> field. Drag to move, use the corner to resize.
              </p>
              <label className="btn-ghost mt-4 w-full cursor-pointer text-xs">
                Replace template
                <input type="file" accept="application/pdf" className="hidden" onChange={onUpload} />
              </label>

              {selected && (
                <FieldInspector
                  field={fields.find((f) => f.id === selected)!}
                  onChange={(p) => updateField(selected, p)}
                  onDelete={() => removeField(selected)}
                />
              )}
              {status && <p className="mt-3 text-xs text-cti-gray">{status}</p>}
            </div>
          </aside>

          {/* Pages */}
          <div className="space-y-6">
            {Array.from({ length: pageCount }).map((_, i) => (
              <PageCanvas
                key={i}
                pdfBytes={pdfBytes}
                pageIndex={i}
                fields={fields.filter((f) => f.page === i)}
                selected={selected}
                onAdd={(nx, ny) => addField(i, nx, ny)}
                onSelect={setSelected}
                onMove={(id, nx, ny) => updateField(id, { x: nx, y: ny })}
                onResize={(id, w, h) => updateField(id, { width: w, height: h })}
              />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function FieldInspector({
  field,
  onChange,
  onDelete,
}: {
  field: LocalField
  onChange: (p: Partial<LocalField>) => void
  onDelete: () => void
}) {
  return (
    <div className="mt-4 border-t border-cti-line pt-4">
      <p className="label">Selected: {field.type}</p>
      <label className="label mt-2">Label</label>
      <input className="input" value={field.label} onChange={(e) => onChange({ label: e.target.value })} />
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>
      <button className="btn-ghost mt-3 w-full text-cti-red" onClick={onDelete}>
        Delete field
      </button>
    </div>
  )
}

function PageCanvas({
  pdfBytes,
  pageIndex,
  fields,
  selected,
  onAdd,
  onSelect,
  onMove,
  onResize,
}: {
  pdfBytes: ArrayBuffer
  pageIndex: number
  fields: LocalField[]
  selected: string | null
  onAdd: (nx: number, ny: number) => void
  onSelect: (id: string) => void
  onMove: (id: string, nx: number, ny: number) => void
  onResize: (id: string, w: number, h: number) => void
}) {
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
    if (drag.current) return
    if ((e.target as HTMLElement).dataset.field) return
    const rect = wrapRef.current!.getBoundingClientRect()
    onAdd((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const rect = wrapRef.current!.getBoundingClientRect()
    const dx = (e.clientX - drag.current.sx) / rect.width
    const dy = (e.clientY - drag.current.sy) / rect.height
    const f = fields.find((x) => x.id === drag.current!.id)
    if (!f) return
    if (drag.current.mode === 'move') {
      onMove(f.id, clamp(drag.current.ox + dx, 0, 1 - f.width), clamp(drag.current.oy + dy, 0, 1 - f.height))
    } else {
      onResize(f.id, clamp(drag.current.ox + dx, 0.03, 1 - f.x), clamp(drag.current.oy + dy, 0.02, 1 - f.y))
    }
  }

  const endDrag = () => (drag.current = null)

  return (
    <div className="card inline-block overflow-hidden p-0">
      <div
        ref={wrapRef}
        className="relative cursor-crosshair"
        style={{ width: size.w, height: size.h }}
        onClick={handleClick}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <canvas ref={canvasRef} className="block" />
        {fields.map((f) => (
          <div
            key={f.id}
            data-field="1"
            onPointerDown={(e) => {
              e.stopPropagation()
              onSelect(f.id)
              drag.current = { id: f.id, mode: 'move', sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y }
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            }}
            className={`absolute flex items-center justify-center rounded text-[10px] font-semibold uppercase tracking-wide ${
              selected === f.id ? 'ring-2 ring-cti-red' : ''
            }`}
            style={{
              left: `${f.x * 100}%`,
              top: `${f.y * 100}%`,
              width: `${f.width * 100}%`,
              height: `${f.height * 100}%`,
              background: 'rgba(225,27,34,0.12)',
              border: '1px dashed #E11B22',
              color: '#B3151B',
            }}
          >
            {f.type}
            <span
              data-field="1"
              onPointerDown={(e) => {
                e.stopPropagation()
                drag.current = { id: f.id, mode: 'resize', sx: e.clientX, sy: e.clientY, ox: f.width, oy: f.height }
                ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              }}
              className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize bg-cti-red"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}
