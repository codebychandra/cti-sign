import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Project } from '../lib/types'
import { PageHeader } from '../components/Layout'

export function Dashboard() {
  const { session } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setProjects((data as Project[]) ?? [])
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
      .insert({ name: name.trim(), description: description.trim(), owner_id: session!.user.id })
    if (error) return setError(error.message)
    setName('')
    setDescription('')
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
              <h3 className="font-heading font-bold text-cti-black">{p.name}</h3>
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
