import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SignatureCanvas from 'react-signature-canvas'
import { supabase, isConfigured } from '../lib/supabase'
import type { FormField } from '../lib/types'
import { buildSignedPdf, renderPage } from '../lib/pdf'
import { Logo } from '../components/Logo'

const RENDER_WIDTH = 720

interface Session {
  record: { signer_name: string; signer_email: string; message: string; status: string }
  form: { name: string; page_count: number; template_path?: string }
  fields: FormField[]
  custom_values?: Record<string, string>
  templateUrl?: string
}

export function SignPage() {
  const { token } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [done, setDone] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [padFor, setPadFor] = useState<string | null>(null)

  useEffect(() => {
    if (!isConfigured) {
      setError('This signing service is not configured yet.')
      setLoading(false)
      return
    }
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc('get_signing_session', { p_token: token })
        if (error) throw new Error(error.message)
        if (!data || data.error) throw new Error(data?.error || 'Invalid or expired signing link')
        const s = data as Session
        setSession(s)
        if (s.record.status === 'completed') setDone(true)
        const today = new Date().toISOString().slice(0, 10)
        const seed: Record<string, string> = {}
        for (const f of s.fields) {
          if (f.custom_field_id && s.custom_values?.[f.custom_field_id]) seed[f.id] = s.custom_values[f.custom_field_id]
          else if (f.type === 'date' || f.type === 'signed_date') seed[f.id] = today
          else if (f.type === 'email') seed[f.id] = s.record.signer_email
        }
        setValues(seed)
        const templateUrl = s.templateUrl || `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/templates/${s.form.template_path}`
        const tpl = await fetch(templateUrl)
        if (!tpl.ok) throw new Error('Could not load the document template')
        setPdfBytes(await tpl.arrayBuffer())
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const submit = async () => {
    if (!session || !pdfBytes) return
    const missing = session.fields.filter((f) => f.required && !values[f.id])
    if (missing.length) {
      setError(`Please complete: ${missing.map((f) => f.label || f.type).join(', ')}`)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const valueRows = session.fields
        .filter((f) => values[f.id])
        .map((f) => ({ id: f.id, field_id: f.id, record_id: '', value: values[f.id] }))
      const signed = await buildSignedPdf(pdfBytes, session.fields, valueRows as any)
      const pdfBase64 = bytesToBase64(signed)
      const { data, error } = await supabase.rpc('submit_signature', {
        p_token: token,
        p_values: session.fields.filter((f) => values[f.id]).map((f) => ({ field_id: f.id, value: values[f.id] })),
        p_pdf: pdfBase64,
      })
      if (error) throw new Error(error.message)
      if (data?.error) throw new Error(data.error)
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Centered>Loading document...</Centered>
  if (error && !session) return <Centered><span className="text-cti-red">{error}</span></Centered>
  if (done)
    return (
      <Centered>
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-green-100 text-2xl">OK</div>
          <h1 className="font-heading text-xl font-bold text-cti-black">Thank you, all done!</h1>
          <p className="mt-2 text-cti-gray">Your signature has been submitted for final review. You may close this window.</p>
        </div>
      </Centered>
    )
  if (!session || !pdfBytes) return <Centered>Preparing...</Centered>

  return (
    <div className="min-h-screen bg-cti-bg pb-32">
      <header className="border-b border-cti-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Logo />
          <span className="text-sm text-cti-gray">{session.form.name}</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="card mb-6 p-5">
          <h1 className="font-heading text-lg font-bold text-cti-black">Hi {session.record.signer_name}, please review and sign</h1>
          {session.record.message && <p className="mt-2 text-sm text-cti-gray">{session.record.message}</p>}
          <p className="mt-2 text-xs text-cti-gray">Tap each highlighted signature field to complete it, then submit at the bottom.</p>
        </div>

        <div className="space-y-6">
          {Array.from({ length: session.form.page_count }).map((_, i) => (
            <SignablePage
              key={i}
              pdfBytes={pdfBytes}
              pageIndex={i}
              fields={session.fields.filter((f) => f.page === i)}
              values={values}
              onText={(id, v) => setValues((s) => ({ ...s, [id]: v }))}
              onSignRequest={setPadFor}
            />
          ))}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-cti-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          {error ? <span className="text-sm text-cti-red">{error}</span> : <span className="text-sm text-cti-gray">Ready when you are.</span>}
          <button className="btn-primary" onClick={submit} disabled={submitting}>{submitting ? 'Submitting...' : 'Finish & submit'}</button>
        </div>
      </div>

      {padFor && <SignaturePad onCancel={() => setPadFor(null)} onDone={(dataUrl) => { setValues((s) => ({ ...s, [padFor]: dataUrl })); setPadFor(null) }} />}
    </div>
  )
}

function SignablePage({ pdfBytes, pageIndex, fields, values, onText, onSignRequest }: { pdfBytes: ArrayBuffer; pageIndex: number; fields: FormField[]; values: Record<string, string>; onText: (id: string, v: string) => void; onSignRequest: (id: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: RENDER_WIDTH, h: RENDER_WIDTH * 1.3 })

  useEffect(() => {
    if (canvasRef.current) renderPage(pdfBytes, pageIndex, canvasRef.current, RENDER_WIDTH).then((d) => setSize({ w: d.width, h: d.height }))
  }, [pdfBytes, pageIndex])

  const isSig = (t: string) => t === 'signature' || t === 'initials'

  return (
    <div className="card mx-auto inline-block overflow-hidden p-0" style={{ maxWidth: '100%' }}>
      <div className="relative" style={{ width: size.w, height: size.h, maxWidth: '100%' }}>
        <canvas ref={canvasRef} className="block w-full" />
        {fields.map((f) => {
          const style = { left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` } as const
          const filled = Boolean(values[f.id])
          if (isSig(f.type)) {
            return (
              <button key={f.id} onClick={() => onSignRequest(f.id)} className="absolute overflow-hidden rounded border-2 border-dashed" style={{ ...style, borderColor: filled ? '#16a34a' : '#E11B22', background: filled ? '#fff' : 'rgba(225,27,34,0.1)' }}>
                {filled ? <img src={values[f.id]} className="h-full w-full object-contain" alt="signature" /> : <span className="text-[10px] font-semibold uppercase text-cti-red">Tap to sign</span>}
              </button>
            )
          }
          return (
            <input
              key={f.id}
              value={values[f.id] ?? ''}
              onChange={(e) => onText(f.id, e.target.value)}
              readOnly={Boolean(f.custom_field_id) || f.type === 'signed_date'}
              type={f.type === 'date' || f.type === 'signed_date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : 'text'}
              placeholder={f.label || f.type}
              className="absolute rounded border border-cti-blue bg-blue-50/60 px-1 text-xs outline-none focus:bg-white read-only:border-transparent read-only:bg-white/30"
              style={style}
            />
          )
        })}
      </div>
    </div>
  )
}

function SignaturePad({ onDone, onCancel }: { onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const ref = useRef<SignatureCanvas>(null)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="card w-full max-w-lg p-5">
        <h3 className="font-heading font-bold text-cti-black">Draw your signature</h3>
        <div className="my-4 rounded-md border border-cti-line bg-white">
          <SignatureCanvas ref={ref} penColor="#111111" canvasProps={{ className: 'w-full', height: 200 }} />
        </div>
        <div className="flex justify-between">
          <button className="btn-ghost" onClick={() => ref.current?.clear()}>Clear</button>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button className="btn-primary" onClick={() => { if (ref.current && !ref.current.isEmpty()) onDone(ref.current.toDataURL('image/png')) }}>Apply signature</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-cti-bg px-4">{children}</div>
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}
