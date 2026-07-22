import type { ProjectCustomField, RecordCustomValue } from './types'

// Mirrors worker/zoho.ts's SeafarerRow shape (Zoho Recruit Candidates feed).
export interface SeafarerRow {
  id: string
  fullName: string
  cruiseLine: string
  positionHired: string
  seafarerIdNumber: string
  onboardingStatus: string
  employmentStatus: string
  signOnDate: string
  signOffDate: string
  signOnPort: string
  seamanBookNumber: string
  passportNumber: string
  dateOfBirth: string
  gender: string
  email: string
  phone: string
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// Maps a normalized custom-field label to the SeafarerRow key that should
// fill it. Add aliases here as new project templates use different wording
// for the same underlying data.
const FIELD_ALIASES: Record<string, keyof SeafarerRow> = {
  name: 'fullName',
  'full name': 'fullName',
  'signer name': 'fullName',
  position: 'positionHired',
  'position hired': 'positionHired',
  'position applied': 'positionHired',
  'crew id': 'seafarerIdNumber',
  'crew id number': 'seafarerIdNumber',
  'seafarer id': 'seafarerIdNumber',
  'seafarer id number': 'seafarerIdNumber',
  passport: 'passportNumber',
  'passport number': 'passportNumber',
  'cruise line': 'cruiseLine',
  'sign on port': 'signOnPort',
  'sign on date': 'signOnDate',
  'joining date': 'signOnDate',
  'sign off date': 'signOffDate',
  "seaman's book number": 'seamanBookNumber',
  'seaman s book number': 'seamanBookNumber',
  'seaman book number': 'seamanBookNumber',
  'phone number': 'phone',
  phone: 'phone',
  mobile: 'phone',
  email: 'email',
  'email address': 'email',
  'date of birth': 'dateOfBirth',
  gender: 'gender',
}

/** For each custom field that has a known alias and a non-empty value on the seafarer row, build a {field_id, value} row. Auto-number fields are skipped — they're assigned on creation. */
export function buildCustomValuesFromSeafarer(row: SeafarerRow, customFields: ProjectCustomField[]): RecordCustomValue[] {
  return customFields
    .filter((field) => field.type !== 'auto_number')
    .map((field) => {
      const key = FIELD_ALIASES[normalizeLabel(field.label)]
      const value = key ? row[key] : ''
      return { field_id: field.id, value: value?.trim() ?? '' }
    })
    .filter((row) => row.value)
}

/** Which of a project's custom fields this seafarer row can actually fill — used to preview coverage before copying. */
export function matchedFieldCount(row: SeafarerRow, customFields: ProjectCustomField[]): number {
  return buildCustomValuesFromSeafarer(row, customFields).length
}
