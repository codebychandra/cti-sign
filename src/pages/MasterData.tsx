import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { Form, Project, ProjectCustomField } from '../lib/types'
import { buildCustomValuesFromSeafarer, matchedFieldCount, type SeafarerRow } from '../lib/masterData'
import { PageHeader } from '../components/Layout'

export function MasterData() {
  const [rows, setRows] = useState<SeafarerRow[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)

  const [search, setSearch] = useState('')
  const [cruiseLineFilter, setCruiseLineFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [signOnDateFrom, setSignOnDateFrom] = useState('')
  const [signOnDateTo, setSignOnDateTo] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const [projects, setProjects] = useState<Project[]>([])
  const [targetProjectId, setTargetProjectId] = useState('')
  const [targetForm, setTargetForm] = useState<Form | null>(null)
  const [targetFields, setTargetFields] = useState<ProjectCustomField[]>([])
  const [copying, setCopying] = useState(false)
  const [copyResult, setCopyResult] = useState<string | null>(null)

  const load = async (refresh = false) => {
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    setNotConfigured(false)
    try {
      const res = await api.getMasterData(refresh)
      setRows(res.data)
      setTruncated(res.truncated)
    } catch (e) {
      const message = (e as Error).message
      if (message.includes('not configured')) setNotConfigured(true)
      else setError(message)
    }
    setLoading(false)
    setRefreshing(false)
  }

  useEffect(() => {
    load()
    api
      .list<Project>('projects')
      .then((data) => setProjects(data.filter((p) => !p.deleted_at)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!targetProjectId) {
      setTargetForm(null)
      setTargetFields([])
      return
    }
    Promise.all([
      api.list<Form>('forms', { project_id: targetProjectId }),
      api.list<ProjectCustomField>('custom-fields', { project_id: targetProjectId }),
    ]).then(([forms, fields]) => {
      setTargetForm(forms[0] ?? null)
      setTargetFields(fields)
    })
  }, [targetProjectId])

  const cruiseLines = useMemo(() => Array.from(new Set(rows.map((r) => r.cruiseLine).filter(Boolean))).sort(), [rows])
  const statuses = useMemo(() => Array.from(new Set(rows.map((r) => r.onboardingStatus).filter(Boolean))).sort(), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (cruiseLineFilter && r.cruiseLine !== cruiseLineFilter) return false
      if (statusFilter && r.onboardingStatus !== statusFilter) return false
      if (signOnDateFrom && (!r.signOnDate || r.signOnDate < signOnDateFrom)) return false
      if (signOnDateTo && (!r.signOnDate || r.signOnDate > signOnDateTo)) return false
      if (q && !`${r.fullName} ${r.seafarerIdNumber} ${r.passportNumber}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, cruiseLineFilter, statusFilter, signOnDateFrom, signOnDateTo])

  const selectedRows = filtered.filter((r) => selected[r.id])
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected[r.id])

  const toggleAll = () => {
    setSelected((prev) => {
      const next = { ...prev }
      filtered.forEach((r) => {
        next[r.id] = !allFilteredSelected
      })
      return next
    })
  }

  const targetProject = projects.find((p) => p.id === targetProjectId)
  const canCopy = Boolean(targetProject && targetForm?.has_template && selectedRows.length && !copying)

  const copyToProject = async () => {
    if (!targetProject || !targetForm?.has_template || !selectedRows.length) return
    setCopying(true)
    setCopyResult(null)
    setError(null)
    const isAutoPopulate = targetProject.project_type === 'auto_populate'
    try {
      for (const row of selectedRows) {
        await api.create('records', {
          form_id: targetForm.id,
          project_id: targetProject.id,
          signer_name: isAutoPopulate ? 'Auto Populate Record' : row.fullName || 'Unnamed',
          signer_email: isAutoPopulate ? 'no-reply@cti.local' : row.email || 'no-reply@cti.local',
          message: '',
          status: 'draft',
          values: [],
          custom_values: buildCustomValuesFromSeafarer(row, targetFields),
        })
      }
      setCopyResult(`Copied ${selectedRows.length} record${selectedRows.length > 1 ? 's' : ''} to "${targetProject.name}".`)
      setSelected({})
    } catch (e) {
      setError((e as Error).message)
    }
    setCopying(false)
  }

  return (
    <>
      <PageHeader
        title="Master Data"
        subtitle="Live Seafarer Feed From Zoho Recruit"
        actions={
          <button className="btn-ghost" onClick={() => load(true)} disabled={refreshing || loading}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error && <p className="mb-4 rounded-md border border-cti-red/20 bg-red-50 p-3 text-sm text-cti-red">{error}</p>}
      {copyResult && <p className="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{copyResult}</p>}

      {notConfigured ? (
        <div className="card grid place-items-center p-12 text-center text-cti-gray">
          <p>Zoho isn't connected on this environment yet — ask an admin to add the ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN secrets.</p>
        </div>
      ) : loading ? (
        <p className="text-cti-gray">Loading…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-cti-gray">
            Showing seafarers currently in an active onboarding status (Completing Documents, Ready to Go, Report to Ship, Rescheduled), most recently updated first.
            {truncated && ' This is a large result set — only the most recently updated matches are shown; use search/filters to narrow further.'}
          </p>
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[200px] flex-1">
              <label className="label">Search</label>
              <input className="input" placeholder="Name, Crew ID, Passport…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label className="label">Cruise Line</label>
              <select className="input" value={cruiseLineFilter} onChange={(e) => setCruiseLineFilter(e.target.value)}>
                <option value="">All</option>
                {cruiseLines.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Onboarding Status</label>
              <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Sign On Date Between</label>
              <div className="flex items-center gap-2">
                <input type="date" className="input" value={signOnDateFrom} onChange={(e) => setSignOnDateFrom(e.target.value)} />
                <span className="text-xs text-cti-gray">and</span>
                <input type="date" className="input" value={signOnDateTo} onChange={(e) => setSignOnDateTo(e.target.value)} />
                {(signOnDateFrom || signOnDateTo) && (
                  <button type="button" className="btn-ghost" onClick={() => { setSignOnDateFrom(''); setSignOnDateTo('') }}>Clear</button>
                )}
              </div>
            </div>
            <p className="pb-2 text-xs text-cti-gray">{filtered.length} of {rows.length} seafarers</p>
          </div>

          <div className="card flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[220px]">
              <label className="label">Copy Selected To Project</label>
              <select className="input" value={targetProjectId} onChange={(e) => setTargetProjectId(e.target.value)}>
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <button className="btn-primary" onClick={copyToProject} disabled={!canCopy}>
              {copying ? 'Copying…' : `Copy ${selectedRows.length || ''} to Project`.trim()}
            </button>
            {targetProjectId && !targetForm?.has_template && <p className="text-xs text-cti-red">This project has no uploaded template yet.</p>}
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-cti-line bg-cti-bg text-xs uppercase tracking-wide text-cti-gray">
                <tr>
                  <th className="w-10 border-r border-cti-line px-4 py-3">
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleAll} className="h-4 w-4" />
                  </th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Name</th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Onboarding Status</th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Crew ID</th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Position</th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Cruise Line</th>
                  <th className="whitespace-nowrap border-r border-cti-line px-4 py-3">Sign On Date</th>
                  {targetProjectId && <th className="whitespace-nowrap px-4 py-3">Fields Matched</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-cti-line">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={targetProjectId ? 8 : 7} className="px-4 py-6 text-center text-cti-gray">No seafarers match this filter.</td>
                  </tr>
                )}
                {filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-cti-bg">
                    <td className="border-r border-cti-line px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={Boolean(selected[row.id])}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                      />
                    </td>
                    <td className="border-r border-cti-line px-4 py-2.5 font-semibold text-cti-ink">{row.fullName}</td>
                    <td className="border-r border-cti-line px-4 py-2.5 text-cti-gray">{row.onboardingStatus || '—'}</td>
                    <td className="border-r border-cti-line px-4 py-2.5 text-cti-gray">{row.seafarerIdNumber || '—'}</td>
                    <td className="border-r border-cti-line px-4 py-2.5 text-cti-gray">{row.positionHired || '—'}</td>
                    <td className="border-r border-cti-line px-4 py-2.5 text-cti-gray">{row.cruiseLine || '—'}</td>
                    <td className="border-r border-cti-line px-4 py-2.5 text-cti-gray">{row.signOnDate || '—'}</td>
                    {targetProjectId && <td className="px-4 py-2.5 text-cti-gray">{matchedFieldCount(row, targetFields)} / {targetFields.filter((f) => f.type !== 'auto_number').length}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
