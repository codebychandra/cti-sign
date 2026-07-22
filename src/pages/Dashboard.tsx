import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { Form, Project, ProjectCustomField, ProjectType, SignRecord } from '../lib/types'
import { PageHeader } from '../components/Layout'

const projectTypes: { value: ProjectType; label: string; description: string }[] = [
  { value: 'sent_signature', label: 'Sent Signature', description: 'Send records to crew for signature and admin completion.' },
  { value: 'auto_populate', label: 'Auto Populate', description: 'Map PDF templates and generate documents from record values only.' },
]

export function Dashboard() {
  const [allProjects, setAllProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('sent_signature')
  const [error, setError] = useState<string | null>(null)

  const projects = allProjects.filter((p) => !p.deleted_at)
  const trashedProjects = allProjects.filter((p) => p.deleted_at)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.list<Project>('projects')
      setAllProjects(data.map((project) => ({ ...project, project_type: project.project_type ?? 'sent_signature' })).sort((a, b) => b.created_at.localeCompare(a.created_at)))
    } catch (e) {
      setError((e as Error).message)
    }
    setLoading(false)
  }

  const restoreProject = async (projectId: string) => {
    try {
      await api.update('projects', projectId, { deleted_at: null })
    } catch (e) {
      return setError((e as Error).message)
    }
    load()
  }

  const permanentlyDeleteProject = async (project: Project) => {
    if (!window.confirm(`Permanently delete "${project.name}" and everything in it? This cannot be undone.`)) return
    try {
      const [records, forms, customFields] = await Promise.all([
        api.list<SignRecord>('records', { project_id: project.id }),
        api.list<Form>('forms', { project_id: project.id }),
        api.list<ProjectCustomField>('custom-fields', { project_id: project.id }),
      ])
      await Promise.all(records.map((r) => api.remove('records', r.id)))
      await Promise.all(forms.map((f) => api.remove('forms', f.id)))
      await Promise.all(customFields.map((f) => api.remove('custom-fields', f.id)))
      await api.remove('onedrive-connections', project.id)
      await api.remove('projects', project.id)
    } catch (e) {
      return setError((e as Error).message)
    }
    load()
  }

  useEffect(() => {
    load()
  }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError(null)
    try {
      await api.create('projects', { name: name.trim(), description: description.trim(), project_type: projectType })
    } catch (e) {
      return setError((e as Error).message)
    }
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
        subtitle="Group Your Signing Workflows"
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setShowTrash((v) => !v)}>
              {showTrash ? 'Back to Projects' : `Trash${trashedProjects.length > 0 ? ` (${trashedProjects.length})` : ''}`}
            </button>
            <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ New Project'}
            </button>
          </div>
        }
      />

      {creating && (
        <form onSubmit={create} className="card mb-6 space-y-4 p-5">
          <div>
            <label className="label">Project Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label">Project Type</label>
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
          <button className="btn-primary">Create Project</button>
        </form>
      )}

      {loading ? (
        <p className="text-cti-gray">Loading…</p>
      ) : showTrash ? (
        trashedProjects.length === 0 ? (
          <div className="card grid place-items-center p-12 text-center text-cti-gray">
            <p>Trash is empty.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {trashedProjects.map((p) => (
              <div key={p.id} className="card space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-heading font-bold text-cti-black">{p.name}</h3>
                  <span className="badge bg-cti-bg text-cti-gray">
                    {p.project_type === 'auto_populate' ? 'Auto Populate' : 'Sent Signature'}
                  </span>
                </div>
                {p.description && <p className="text-sm text-cti-gray">{p.description}</p>}
                <p className="text-xs text-cti-gray">Deleted {p.deleted_at ? new Date(p.deleted_at).toLocaleDateString() : ''}</p>
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={() => restoreProject(p.id)}>Restore</button>
                  <button className="btn-ghost flex-1 text-cti-red" onClick={() => permanentlyDeleteProject(p)}>Delete Forever</button>
                </div>
              </div>
            ))}
          </div>
        )
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
                  {p.project_type === 'auto_populate' ? 'Auto Populate' : 'Sent Signature'}
                </span>
              </div>
              {p.description && <p className="mt-1 text-sm text-cti-gray">{p.description}</p>}
              <p className="mt-4 text-xs text-cti-gray">{new Date(p.created_at).toLocaleDateString()}</p>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
