// Profiles: each person gets a unique id. Their entries are stored under that
// id in the browser, and in their own subfolder when saving to a folder.

const USERS_KEY = 'journal.users'
const CURRENT_KEY = 'journal.currentUser'
const LEGACY_ENTRIES = 'journal.entries.v1'

export const entriesKey = (userId) => `journal.entries.${userId}`

const read = (k, fallback) => {
  try {
    const v = localStorage.getItem(k)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* storage unavailable */
  }
}

export const loadUsers = () => read(USERS_KEY, [])
export const saveUsers = (users) => write(USERS_KEY, users)
export const loadCurrentId = () => read(CURRENT_KEY, null)
export const saveCurrentId = (id) => write(CURRENT_KEY, id)

export const hasLegacyEntries = () => read(LEGACY_ENTRIES, []).length > 0

const safe = (s) =>
  s.replace(/[\\/:*?"<>|#^[\]\n\r\t.]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Journal'

export function createUser(name, users) {
  const id = crypto.randomUUID()
  const user = {
    id,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    // Fixed at creation so renaming never moves files
    dirName: `${safe(name)} ${id.slice(0, 8)}`,
  }
  // The very first profile inherits entries written before profiles existed
  if (users.length === 0) {
    const legacy = read(LEGACY_ENTRIES, null)
    if (legacy) {
      write(entriesKey(id), legacy)
      try {
        localStorage.removeItem(LEGACY_ENTRIES)
      } catch {
        /* ignore */
      }
    }
  }
  return user
}

export function deleteUserData(userId) {
  try {
    localStorage.removeItem(entriesKey(userId))
  } catch {
    /* ignore */
  }
}
