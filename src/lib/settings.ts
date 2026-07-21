export interface AppSettings {
  staffName: string
  organizationName: string
  supportEmail: string
  defaultSignatureMessage: string
}

export const defaultSettings: AppSettings = {
  staffName: 'CTI Staff',
  organizationName: 'CTI',
  supportEmail: '',
  defaultSignatureMessage: 'Please review and sign the attached document.',
}

const storageKey = 'cti-sign:settings'

export function getAppSettings(): AppSettings {
  if (typeof window === 'undefined') return defaultSettings

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return defaultSettings
    return { ...defaultSettings, ...JSON.parse(raw) }
  } catch {
    return defaultSettings
  }
}

export function saveAppSettings(settings: AppSettings) {
  window.localStorage.setItem(storageKey, JSON.stringify(settings))
}

export function setStaffName(staffName: string) {
  saveAppSettings({ ...getAppSettings(), staffName })
}

export function resetAppSettings() {
  window.localStorage.removeItem(storageKey)
}
