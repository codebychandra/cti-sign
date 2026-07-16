import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Project, ProjectType } from '../lib/types'
import { PageHeader } from '../components/Layout'

const projectTypes: { value: ProjectType; label: string; description: string }[] = [
  { value: 'sent_signature', label: 'Sent signature', description: 'Send records to crew for signature and admin completion.' },
  { value: 'auto_populate', label: 'Auto populate', description: 'Map PDF templates and generate documents from record values only.' },
]

export function Dashboard() {
  const { session } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('sent_signature')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setProjects(((data as Project[]) ?? []).map((project) => ({ ...project, project_type: project.project_type ?? 'sent_signature' })))
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    const { error } = await supabase
      .from('projects')
      .insert({ name: name.trim(), description: description.trim(), project_type: projectType, owner_id: session!.user.id })
    if (error) return setError(error.message)
    setName('')
    setDescription('')
    setProjectType('sent_signature')
    setCreating(false)
    load()
  }

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Group your signing workflows"
        actions={
          <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New project'}
          </button>
        }
      />

      {creating && (
        <form onSubmit={create} className="card mb-6 space-y-4 p-5">
          <div>
            <label className="label">Project name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Project type</label>
            <div className="grid gap-3 sm:grid-cols-2">
              {projectTypes.map((type) => (
                <label
                  key={type.value}
                  className={`rounded-md border p-4 ${projectType === type.value ? 'border-cti-red bg-red-50' : 'border-cti-line bg-white'}`}
                >
                  <span className="flex items-center gap-2 font-semibold text-cti-ink">
                    <input
                      type="radio"
                      name="projectType"
                      value={type.value}
                      checked={projectType === type.value}
                      onChange={() => setProjectType(type.value)}
                    />
                    {type.label}
                  </span>
                  <span className="mt-1 block text-sm text-cti-gray">{type.description}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {error && <p className="text-sm text-cti-red">{error}</p>}
          <button className="btn-primary">Create project</button>
        </form>
      )}

      {loading ? (
        <p className="text-cti-gray">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="card grid place-items-center p-12 text-center text-cti-gray">
          <p>No projects yet. Create your first one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="card p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-heading font-bold text-cti-black">{p.name}</h3>
                <span className="badge bg-cti-bg text-cti-gray">
                  {p.project_type === 'auto_populate' ? 'Auto populate' : 'Sent signature'}
                </span>
              </div>
              {p.description && <p className="mt-1 text-sm text-cti-gray">{p.description}</p>}
              <p className="mt-4 text-xs text-cti-gray">
                {new Date(p.created_at).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
