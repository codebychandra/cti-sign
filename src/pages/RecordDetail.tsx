import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, functionsBase } from '../lib/supabase'
import type { Form, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'
import { StatusBadge } from '../components/StatusBadge'

export function RecordDetail() {
  const { recordId } = useParams()
  const [record, setRecord] = useState<SignRecord | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('records').select('*').eq('id', recordId).single()
    setRecord(r as SignRecord)
    if (r) {
      const { data: f } = await supabase.from('forms').select('*').eq('id', (r as SignRecord).form_id).single()
      setForm(f as Form)
    }
  }, [recordId])

  useEffect(() => {
    load()
  }, [load])

  if (!record) return <p className="text-cti-gray">Loading…</p>

  const signUrl = `${window.location.origin}${import.meta.env.BASE_URL}sign/${record.token}`

  const send = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const res = await fetch(`${functionsBase}/send-signature-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sess.session?.access_token}`,
        },
        body: JSON.stringify({ recordId: record.id, appUrl: `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '') }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Send failed')
      setMsg('Signing request emailed to ' + record.signer_email)
      load()
    } catch (e) {
      setMsg('Could not send email: ' + (e as Error).message + '. You can still copy the link below.')
    } finally {
      setBusy(false)
    }
  }

  const markSent = async () => {
    await supabase.from('records').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', record.id)
    load()
  }

  const download = async () => {
    if (!record.signed_pdf_path) return
    const { data, error } = await supabase.storage.from('signed').download(record.signed_pdf_path)
    if (error || !data) return setMsg('Download failed: ' + error?.message)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url
    a.download = `${record.signer_name.replace(/\s+/g, '_')}_signed.pdf`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(signUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <PageHeader
        title="Signature record"
        subtitle={form?.name}
        actions={
          <Link to={`/projects/${record.project_id}`} className="btn-ghost">
            ← Back to project
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-4 p-6">
          <Row label="Signer" value={record.signer_name} />
          <Row label="Email" value={record.signer_email} />
          <div className="flex items-center justify-between">
            <span className="text-sm text-cti-gray">Status</span>
            <StatusBadge status={record.status} />
          </div>
          {record.sent_at && <Row label="Sent" value={new Date(record.sent_at).toLocaleString()} />}
          {record.viewed_at && <Row label="Viewed" value={new Date(record.viewed_at).toLocaleString()} />}
          {record.completed_at && <Row label="Completed" value={new Date(record.completed_at).toLocaleString()} />}
        </div>

        <div className="card space-y-4 p-6">
          <h3 className="font-heading font-bold text-cti-black">Actions</h3>

          {record.status === 'completed' ? (
            <button className="btn-primary w-full" onClick={download}>
              ⬇ Download signed PDF
            </button>
          ) : (
            <>
              <button className="btn-primary w-full" onClick={send} disabled={busy}>
                {busy ? 'Sending…' : record.status === 'draft' ? 'Send for signature (email)' : 'Resend email'}
              </button>
              <div>
                <label className="label">Signing link (copy & send manually)</label>
                <div className="flex gap-2">
                  <input className="input font-mono text-xs" readOnly value={signUrl} />
                  <button className="btn-ghost whitespace-nowrap" onClick={copy}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                {record.status === 'draft' && (
                  <button className="mt-2 text-xs text-cti-gray hover:text-cti-ink" onClick={markSent}>
                    Mark as sent (without email)
                  </button>
                )}
              </div>
            </>
          )}

          {msg && <p className="text-sm text-cti-ink">{msg}</p>}
        </div>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-cti-gray">{label}</span>
      <span className="text-sm font-semibold text-cti-ink">{value}</span>
    </div>
  )
}
