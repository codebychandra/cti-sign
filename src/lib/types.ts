export type RecordStatus = 'draft' | 'sent' | 'viewed' | 'completed' | 'declined'
export type FieldType = 'signature' | 'initials' | 'text' | 'date' | 'name' | 'email'
export type TextAlign = 'left' | 'center' | 'right'
export type CustomFieldType = 'text' | 'date' | 'number' | 'email'

export interface Project {
  id: string
  name: string
  description: string
  owner_id: string
  created_at: string
}

export interface Form {
  id: string
  project_id: string
  name: string
  template_path: string | null
  page_count: number
  created_at: string
}

export interface FormField {
  id: string
  form_id: string
  type: FieldType
  label: string
  page: number
  x: number
  y: number
  width: number
  height: number
  text_align: TextAlign
  font_size: number
  required: boolean
  sort_order: number
}

export interface ProjectCustomField {
  id: string
  project_id: string
  label: string
  type: CustomFieldType
  required: boolean
  sort_order: number
  created_at: string
}

export interface SignRecord {
  id: string
  form_id: string
  project_id: string
  signer_name: string
  signer_email: string
  status: RecordStatus
  token: string
  signed_pdf_path: string | null
  signed_pdf_data?: string | null
  onedrive_url: string | null
  message: string
  sent_at: string | null
  viewed_at: string | null
  completed_at: string | null
  created_by: string | null
  created_at: string
}

export interface RecordValue {
  id: string
  record_id: string
  field_id: string
  value: string | null
}

export interface RecordCustomValue {
  id: string
  record_id: string
  field_id: string
  value: string | null
}
