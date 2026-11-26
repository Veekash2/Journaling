// Store entries as Markdown files in a folder the user picks (works as an
// Obsidian vault). Photos go in an "attachments" subfolder. Only files this app
// wrote (they carry a journal_id) are ever read, changed or deleted.
// Needs the File System Access API (Chrome / Edge on desktop).

import { getPhoto, putPhoto } from './photos.js'

export const folderSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

const ATTACH = 'attachments'
const PHOTO_MARK = '%% photos %%'

/* ---------- remembering the chosen folder between visits ---------- */

function settingsDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('journal-settings', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function kv(mode, fn) {
  const d = await settingsDb()
  return new Promise((resolve, reject) => {
    const t = d.transaction('kv', mode)
    const r = fn(t.objectStore('kv'))
    t.oncomplete = () => resolve(r?.result)
    t.onerror = () => reject(t.error)
  })
}
// One saved folder per profile
export const loadSavedFolder = (userId) => kv('readonly', (s) => s.get(`folder:${userId}`)).catch(() => null)
export const saveFolder = (userId, handle) => kv('readwrite', (s) => s.put(handle, `folder:${userId}`))
export const forgetFolder = (userId) => kv('readwrite', (s) => s.delete(`folder:${userId}`))

export async function pickFolder() {
  return window.showDirectoryPicker({ id: 'journal', mode: 'readwrite', startIn: 'documents' })
}

// 'granted' | 'prompt' | 'denied'
export async function permission(handle, ask = false) {
  const opts = { mode: 'readwrite' }
  let p = await handle.queryPermission(opts)
  if (p === 'prompt' && ask) p = await handle.requestPermission(opts)
  return p
}

/* ---------- Markdown format ---------- */

const q = (v) => JSON.stringify(String(v ?? ''))

export function toMarkdown(e) {
  const lines = [
    '---',
    `journal_id: ${q(e.id)}`,
    `created: ${q(e.createdAt)}`,
    `updated: ${q(e.updatedAt)}`,
    `title: ${q(e.title)}`,
    `mood: ${q(e.mood)}`,
  ]
  if (e.photos?.length) {
    lines.push('photos:')
    for (const p of e.photos) lines.push(`  - ${q(p)}`)
  }
  lines.push('---', '')
  let md = lines.join('\n') + (e.body || '')
  if (e.photos?.length) {
    md += `\n\n${PHOTO_MARK}\n` + e.photos.map((p) => `![[${ATTACH}/${p}.jpg]]`).join('\n')
  }
  return md + '\n'
}

const unq = (v) => {
  v = v.trim()
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v)
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

export function fromMarkdown(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const meta = {}
  let listKey = null
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item && listKey) {
      meta[listKey].push(unq(item[1]))
      continue
    }
    const kvm = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (!kvm) continue
    if (kvm[2] === '') {
      listKey = kvm[1]
      meta[listKey] = []
    } else {
      listKey = null
      meta[kvm[1]] = unq(kvm[2])
    }
  }
  if (!meta.journal_id || isNaN(Date.parse(meta.created))) return null
  let body = m[2]
  const cut = body.lastIndexOf(PHOTO_MARK)
  if (cut !== -1) body = body.slice(0, cut)
  return {
    id: meta.journal_id,
    createdAt: meta.created,
    updatedAt: isNaN(Date.parse(meta.updated)) ? meta.created : meta.updated,
    title: meta.title || '',
    mood: meta.mood || '',
    photos: Array.isArray(meta.photos) ? meta.photos : [],
    body: body.replace(/\s+$/, ''),
  }
}

/* ---------- file names ---------- */

const pad = (n) => String(n).padStart(2, '0')
export function fileNameFor(e, taken) {
  const d = new Date(e.createdAt)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const title =
    (e.title || (e.photos?.length && !e.body.trim() ? 'Handwritten entry' : 'Journal entry'))
      .replace(/[\\/:*?"<>|#^[\]\n\r\t]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Journal entry'
  let name = `${date} ${title}.md`
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${date} ${title} (${i}).md`
  return name
}

/* ---------- reading & writing ---------- */

async function attachments(dir, create = false) {
  try {
    return await dir.getDirectoryHandle(ATTACH, { create })
  } catch {
    return null
  }
}

const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

// Returns { entries, files: Map(id -> fileName) }
export async function readFolder(dir) {
  const entries = []
  const files = new Map()
  const att = await attachments(dir)
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    const e = fromMarkdown(await file.text())
    if (!e) continue // not one of ours
    // Edited in another app (e.g. Obsidian)? Use the file's time.
    if (file.lastModified > Date.parse(e.updatedAt) + 5000) e.updatedAt = new Date(file.lastModified).toISOString()
    if (files.has(e.id)) continue
    files.set(e.id, name)
    entries.push(e)
    if (att) {
      for (const pid of e.photos) {
        if (await getPhoto(pid)) continue
        try {
          const f = await (await att.getFileHandle(`${pid}.jpg`)).getFile()
          await putPhoto(pid, await blobToDataUrl(f))
        } catch {
          /* photo file missing */
        }
      }
    }
  }
  return { entries, files }
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  await w.write(data)
  await w.close()
}

export async function removeFile(dir, name) {
  try {
    await dir.removeEntry(name)
  } catch {
    /* already gone */
  }
}

export async function writeEntry(dir, e, name) {
  if (e.photos?.length) {
    const att = await attachments(dir, true)
    for (const pid of e.photos) {
      try {
        await att.getFileHandle(`${pid}.jpg`) // already there
      } catch {
        const url = await getPhoto(pid)
        if (url) await writeFile(att, `${pid}.jpg`, await (await fetch(url)).blob())
      }
    }
  }
  await writeFile(dir, name, toMarkdown(e))
}

export async function removePhotoFiles(dir, ids) {
  if (!ids.length) return
  const att = await attachments(dir)
  if (!att) return
  for (const pid of ids) await removeFile(att, `${pid}.jpg`)
}
