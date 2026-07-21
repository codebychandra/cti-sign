export type RecordStatus = 'draft' | 'sent' | 'viewed' | 'submitted' | 'completed' | 'declined'
export type FieldType = 'signature' | 'initials' | 'text' | 'textarea' | 'date' | 'signed_date' | 'number' | 'email'
export type TextAlign = 'left' | 'center' | 'right'
export type CustomFieldType = 'text' | 'date' | 'number' | 'email' | 'auto_number' | 'single_dropdown' | 'multi_dropdown'
export type ProjectType = 'sent_signature' | 'auto_populate'

export interface Project {
  id: string
  name: string
  description: string
  project_type: ProjectType
  message_template: string
  created_at: string
}

export interface FormField {
  id: string
  type: FieldType
  label: string
  custom_field_id: string | null
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

export interface Form {
  id: string
  project_id: string
  name: string
  page_count: number
  has_template: boolean
  fields: FormField[]
  created_at: string
}

export interface ProjectCustomField {
  id: string
  project_id: string
  label: string
  type: CustomFieldType
  required: boolean
  show_in_table: boolean
  auto_prefix: string | null
  auto_start: number | null
  options: string[] | null
  sort_order: number
}

export interface RecordValue {
  field_id: string
  value: string
}

export interface RecordCustomValue {
  field_id: string
  value: string
}

export interface SignRecord {
  id: string
  form_id: string
  project_id: string
  signer_name: string
  signer_email: string
  status: RecordStatus
  token: string
  onedrive_url: string | null
  onedrive_uploaded_at: string | null
  message: string
  sent_at: string | null
  viewed_at: string | null
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  values: RecordValue[]
  custom_values: RecordCustomValue[]
}
