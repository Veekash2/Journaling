import { useEffect, useMemo, useRef, useState } from 'react'
import MoodChart from './MoodChart.jsx'
import { exportPdf } from './pdf.js'
import PhotoGallery from './PhotoGallery.jsx'
import { compressImage, deletePhotos, getPhotos, putPhoto } from './photos.js'
import { entriesKey } from './users.js'
import {
  fileNameFor,
  folderSupported,
  forgetFolder,
  loadSavedFolder,
  permission,
  pickFolder,
  readFolder,
  removeFile,
  removePhotoFiles,
  saveFolder,
  writeEntry,
} from './folder.js'
const MOODS = ['Calm', 'Happy', 'Grateful', 'Hopeful', 'Tired', 'Anxious', 'Sad', 'Angry']

function loadEntries(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveEntries(key, entries) {
  try {
    localStorage.setItem(key, JSON.stringify(entries))
  } catch {
    /* storage unavailable — entries stay in memory for this visit */
  }
}

const isEmpty = (e) => !e.title.trim() && !e.body.trim() && !e.mood && !e.photos?.length

const isToday = (iso) => new Date(iso).toDateString() === new Date().toDateString()
// Today's entries and blank drafts open ready to write; older ones open to read
const opensInEditor = (e) => !e || isEmpty(e) || isToday(e.createdAt)

function newEntry() {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), createdAt: now, updatedAt: now, title: '', body: '', mood: '', photos: [] }
}

const fmtLong = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fmtTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const fmtShort = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
const dateValue = (iso) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const entryTitle = (e) =>
  e.title || (e.photos?.length && !e.body.trim() ? 'Handwritten entry' : isEmpty(e) ? 'New entry' : 'Untitled')
const photoCount = (n) => `${n} ${n === 1 ? 'photo' : 'photos'}`
const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt)

// Combine two lists of entries; when both have the same entry, the newer edit wins
function mergeLists(a, b) {
  const byId = new Map(a.map((e) => [e.id, e]))
  for (const e of b) {
    const cur = byId.get(e.id)
    if (!cur || e.updatedAt > cur.updatedAt) byId.set(e.id, e)
  }
  return [...byId.values()]
}

const monthKey = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

export default function App({ user, onProfiles }) {
  const storageKey = entriesKey(user.id)
  const [entries, setEntries] = useState(() => {
    const loaded = loadEntries(storageKey)
    return loaded.length ? loaded : [newEntry()]
  })
  const [selectedId, setSelectedId] = useState(
    () => [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id
  )
  const [editing, setEditing] = useState(() =>
    opensInEditor([...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  )
  const [query, setQuery] = useState('')
  const [showList, setShowList] = useState(false) // mobile only
  const [view, setView] = useState('write') // 'write' | 'mood'
  const bodyRef = useRef(null)
  const [adding, setAdding] = useState(false)
  const [undo, setUndo] = useState(null) // { entry, timer }

  // Folder storage: none | loading | connected | needs-permission | error
  const [folder, setFolder] = useState({ status: folderSupported ? 'loading' : 'none' })
  const rootDirRef = useRef(null) // the folder the person chose
  const dirRef = useRef(null) // their own subfolder inside it
  const syncedRef = useRef(new Map()) // entry id -> { name, updatedAt, photos }
  const chainRef = useRef(Promise.resolve())
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'light'
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('journal.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  // When an entry opens for writing, put the cursor at the end of the text
  useEffect(() => {
    const el = bodyRef.current
    if (!el || view !== 'write' || !editing) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing, selectedId, view])

  // Persist everything except blank drafts (a browser copy is kept even in folder mode)
  useEffect(() => {
    saveEntries(storageKey, entries.filter((e) => !isEmpty(e)))
  }, [entries, storageKey])

  /* ---------- folder storage ---------- */

  function showEntries(list) {
    const next = list.length ? list : [newEntry()]
    const first = [...next].sort(newestFirst)[0]
    setEntries(next)
    setSelectedId(first.id)
    setEditing(opensInEditor(first))
  }

  async function connect(handle, merge) {
    const dir = await handle.getDirectoryHandle(user.dirName, { create: true })
    const { entries: onDisk, files } = await readFolder(dir)
    const synced = new Map()
    for (const e of onDisk) synced.set(e.id, { name: files.get(e.id), updatedAt: e.updatedAt, photos: e.photos })
    syncedRef.current = synced
    rootDirRef.current = handle
    dirRef.current = dir
    const mine = entriesRef.current.filter((e) => !isEmpty(e))
    showEntries(merge ? mergeLists(mine, onDisk) : onDisk)
    setFolder({ status: 'connected', name: handle.name })
  }

  useEffect(() => {
    if (!folderSupported) return
    let alive = true
    ;(async () => {
      const handle = await loadSavedFolder(user.id)
      if (!alive) return
      if (!handle) return setFolder({ status: 'none' })
      rootDirRef.current = handle
      const p = await permission(handle).catch(() => 'denied')
      if (!alive) return
      if (p === 'granted') {
        await connect(handle, false).catch((err) =>
          setFolder({ status: 'error', name: handle.name, message: String(err?.message || err) })
        )
      } else setFolder({ status: 'needs-permission', name: handle.name })
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id])

  async function syncToFolder(list) {
    const dir = dirRef.current
    if (!dir) return
    const synced = syncedRef.current
    const live = new Set(list.map((e) => e.id))
    for (const [id, info] of [...synced]) {
      if (live.has(id)) continue
      await removeFile(dir, info.name)
      await removePhotoFiles(dir, info.photos || [])
      synced.delete(id)
    }
    for (const e of list) {
      const prev = synced.get(e.id)
      if (prev && prev.updatedAt === e.updatedAt) continue
      const taken = new Set(
        [...synced].filter(([id]) => id !== e.id).map(([, v]) => v.name.toLowerCase())
      )
      const name = fileNameFor(e, taken)
      await writeEntry(dir, e, name)
      if (prev && prev.name !== name) await removeFile(dir, prev.name)
      if (prev) await removePhotoFiles(dir, (prev.photos || []).filter((x) => !e.photos?.includes(x)))
      synced.set(e.id, { name, updatedAt: e.updatedAt, photos: e.photos || [] })
    }
  }

  useEffect(() => {
    if (folder.status !== 'connected') return
    const t = setTimeout(() => {
      const snapshot = entriesRef.current.filter((e) => !isEmpty(e))
      chainRef.current = chainRef.current
        .then(() => syncToFolder(snapshot))
        .catch((err) =>
          setFolder((f) => ({ ...f, status: 'error', message: String(err?.message || err) }))
        )
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, folder.status])

  async function chooseFolder() {
    let handle
    try {
      handle = await pickFolder()
    } catch {
      return // picker closed
    }
    try {
      await saveFolder(user.id, handle)
      await connect(handle, true)
    } catch (err) {
      setFolder({ status: 'error', name: handle.name, message: String(err?.message || err) })
    }
  }

  async function reconnect() {
    const handle = rootDirRef.current
    if (!handle) return
    const p = await permission(handle, true).catch(() => 'denied')
    if (p !== 'granted') return
    await connect(handle, folder.status === 'error').catch((err) =>
      setFolder({ status: 'error', name: handle.name, message: String(err?.message || err) })
    )
  }

  async function switchToBrowser() {
    await forgetFolder(user.id).catch(() => {})
    rootDirRef.current = null
    dirRef.current = null
    syncedRef.current = new Map()
    setFolder({ status: 'none' })
    setView('write')
  }

  const selected = entries.find((e) => e.id === selectedId)

  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [entries]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((e) =>
      [e.title, e.body, e.mood].some((s) => s.toLowerCase().includes(q))
    )
  }, [sorted, query])

  const groups = useMemo(() => {
    const map = new Map()
    for (const e of filtered) {
      const k = monthKey(e.createdAt)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(e)
    }
    return [...map.entries()]
  }, [filtered])

  const savedCount = entries.filter((e) => !isEmpty(e)).length

  function update(patch) {
    setEntries((list) =>
      list.map((e) => (e.id === selectedId ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e))
    )
  }

  // Move an entry to another day (keeps its time of day)
  function changeDate(value) {
    if (!value || !selected) return
    const [y, m, d] = value.split('-').map(Number)
    const old = new Date(selected.createdAt)
    const next = new Date(y, m - 1, d, old.getHours(), old.getMinutes(), old.getSeconds())
    if (isNaN(next)) return
    update({ createdAt: next.toISOString() })
  }

  async function addPhotos(ev) {
    const files = [...(ev.target.files || [])]
    ev.target.value = ''
    if (!files.length || !selected) return
    const entryId = selectedId
    setAdding(true)
    const ids = []
    try {
      for (const f of files) {
        const id = crypto.randomUUID()
        await putPhoto(id, await compressImage(f))
        ids.push(id)
      }
    } catch {
      window.alert("Some photos couldn't be added. Try a JPG or PNG image.")
    } finally {
      setAdding(false)
    }
    if (!ids.length) return
    setEntries((list) =>
      list.map((e) =>
        e.id === entryId
          ? { ...e, photos: [...(e.photos || []), ...ids], updatedAt: new Date().toISOString() }
          : e
      )
    )
  }

  function removePhoto(id) {
    if (!window.confirm('Remove this photo from the entry?')) return
    update({ photos: (selected.photos || []).filter((p) => p !== id) })
    deletePhotos([id])
  }

  // Drop the current entry if it's still blank when leaving it
  function leaveCurrent(list) {
    const cur = list.find((e) => e.id === selectedId)
    return cur && isEmpty(cur) ? list.filter((e) => e.id !== selectedId) : list
  }

  function select(id) {
    setView('write')
    setEditing(opensInEditor(entries.find((e) => e.id === id)))
    if (id === selectedId) return setShowList(false)
    setEntries((list) => leaveCurrent(list))
    setSelectedId(id)
    setShowList(false)
  }

  function create() {
    setView('write')
    setEditing(true)
    if (selected && isEmpty(selected)) {
      setShowList(false)
      bodyRef.current?.focus()
      return
    }
    const e = newEntry()
    setEntries((list) => [e, ...list])
    setSelectedId(e.id)
    setShowList(false)
    setTimeout(() => bodyRef.current?.focus(), 0)
  }

  // Photos of a deleted entry are only removed once Undo is no longer offered
  const undoRef = useRef(null)
  undoRef.current = undo
  function finishDelete(u) {
    if (!u) return
    clearTimeout(u.timer)
    deletePhotos(u.entry.photos || [])
  }
  useEffect(() => () => finishDelete(undoRef.current), [])

  function remove(id = selectedId) {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    const rest = entries.filter((e) => e.id !== id)
    if (id === selectedId) {
      const next = [...rest].sort(newestFirst)[0]
      if (!next) {
        const e = newEntry()
        rest.push(e)
        setSelectedId(e.id)
        setEditing(true)
      } else {
        setSelectedId(next.id)
        setEditing(opensInEditor(next))
      }
    }
    setEntries(rest)
    if (isEmpty(entry)) return
    finishDelete(undo)
    const timer = setTimeout(() => {
      setUndo((u) => {
        if (u?.entry.id === entry.id) finishDelete(u)
        return u?.entry.id === entry.id ? null : u
      })
    }, 8000)
    setUndo({ entry, timer })
  }

  function undoDelete() {
    if (!undo) return
    clearTimeout(undo.timer)
    const { entry } = undo
    setUndo(null)
    setEntries((list) => [...list.filter((e) => !isEmpty(e)), entry])
    setSelectedId(entry.id)
    setEditing(opensInEditor(entry))
    setView('write')
  }

  async function exportAll() {
    const saved = entries.filter((e) => !isEmpty(e))
    const photos = await getPhotos(saved.flatMap((e) => e.photos || []))
    const data = JSON.stringify({ version: 2, entries: saved, photos })
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `journal-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function importFile(ev) {
    const file = ev.target.files?.[0]
    ev.target.value = '' // allow picking the same file again later
    if (!file) return
    let incoming
    try {
      incoming = JSON.parse(await file.text())
      // Older backups are a plain list; newer ones also carry photos
      if (incoming && Array.isArray(incoming.entries)) {
        for (const [id, url] of Object.entries(incoming.photos || {})) {
          if (typeof url === 'string' && url.startsWith('data:image/')) await putPhoto(id, url)
        }
        incoming = incoming.entries
      }
      if (!Array.isArray(incoming)) throw new Error()
    } catch {
      window.alert("That file isn't a journal backup. Choose a file made with Export.")
      return
    }
    const valid = incoming
      .filter((e) => e && typeof e.id === 'string' && typeof e.createdAt === 'string' && !isNaN(Date.parse(e.createdAt)))
      .map((e) => ({
        id: e.id,
        createdAt: e.createdAt,
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : e.createdAt,
        title: String(e.title ?? ''),
        body: String(e.body ?? ''),
        mood: MOODS.includes(e.mood) ? e.mood : '',
        photos: Array.isArray(e.photos) ? e.photos.filter((p) => typeof p === 'string') : [],
      }))
      .filter((e) => !isEmpty(e))
    if (valid.length === 0) {
      window.alert('No entries found in that file.')
      return
    }

    // Merge: new entries are added; for ones you already have, the newer edit wins
    const byId = new Map(entries.filter((e) => !isEmpty(e)).map((e) => [e.id, e]))
    let added = 0
    let updated = 0
    for (const e of valid) {
      const cur = byId.get(e.id)
      if (!cur) {
        byId.set(e.id, e)
        added++
      } else if (e.updatedAt > cur.updatedAt) {
        byId.set(e.id, e)
        updated++
      }
    }
    const merged = [...byId.values()]
    if (merged.length === 0) return
    setEntries(merged)
    if (!byId.has(selectedId)) {
      const next = [...merged].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      setSelectedId(next.id)
      setEditing(opensInEditor(next))
    }
    const unchanged = valid.length - added - updated
    if (added === 0 && updated === 0) {
      window.alert('Everything in that file is already in your journal.')
      return
    }
    window.alert(
      `Imported ${added} new ${added === 1 ? 'entry' : 'entries'}` +
        (updated ? `, updated ${updated}` : '') +
        (unchanged ? `. ${unchanged} already up to date.` : '.')
    )
  }

  const words = selected ? (selected.body.trim().match(/\S+/g) || []).length : 0

  if (folder.status === 'loading') {
    return <div className="welcome"><p className="muted">Opening your journal…</p></div>
  }
  if (folder.status === 'needs-permission') {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1 className="chart-title">Welcome back, {user.name}</h1>
          <p className="muted">
            Your journal is saved in the folder “{folder.name}”. Chrome needs your OK to open it again.
          </p>
          <div className="store-actions">
            <button className="btn primary" onClick={reconnect}>Open folder</button>
            <button className="btn" onClick={switchToBrowser}>Use this browser instead</button>
          </div>
          <button className="link small" onClick={onProfiles}>Switch profile</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`app ${showList ? 'show-list' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <h1>Journal</h1>
          <span className="count">{savedCount} {savedCount === 1 ? 'entry' : 'entries'}</span>
        </div>
        <div className="who">
          <span className="who-name">{user.name}</span>
          <button className="link small" onClick={onProfiles}>Switch</button>
        </div>

        <button className="btn primary full" onClick={create}>New entry</button>
        <button
          className={`btn full ${view === 'mood' ? 'selected' : ''}`}
          onClick={() => { setView('mood'); setShowList(false) }}
        >
          Mood chart
        </button>

        <input
          className="search"
          type="search"
          placeholder="Search entries"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <nav className="list">
          {groups.length === 0 && <p className="muted small pad">No entries match.</p>}
          {groups.map(([month, items]) => (
            <section key={month}>
              <h2 className="month">{month}</h2>
              {items.map((e) => (
                <div key={e.id} className={`item-row ${view === 'write' && e.id === selectedId ? 'active' : ''}`}>
                <button
                  className={`item ${view === 'write' && e.id === selectedId ? 'active' : ''}`}
                  onClick={() => select(e.id)}
                >
                  <span className="item-top">
                    <span className="item-date">{fmtShort(e.createdAt)}</span>
                    {e.mood && <span className="item-mood">{e.mood}</span>}
                  </span>
                  <span className="item-title">{entryTitle(e)}</span>
                  <span className="item-preview">
                    {e.body.slice(0, 90) || (e.photos?.length ? photoCount(e.photos.length) : '—')}
                  </span>
                </button>
                <button
                  className="item-delete"
                  onClick={() => remove(e.id)}
                  aria-label={`Delete ${entryTitle(e)}`}
                  title="Delete entry"
                >
                  Delete
                </button>
                </div>
              ))}
            </section>
          ))}
        </nav>

        <div className="backup">
          {savedCount > 0 && (
            <>
              <button
                className="link small"
                onClick={() => exportPdf(entries.filter((e) => !isEmpty(e)), MOODS, getPhotos)}
              >
                Export PDF
              </button>
              <button className="link small" onClick={exportAll}>Backup</button>
            </>
          )}
          <label className="link small">
            Import
            <input type="file" accept=".json,application/json" onChange={importFile} hidden />
          </label>
          <button className="link small" onClick={() => { setView('settings'); setShowList(false) }}>
            Storage
          </button>
        </div>
        {folder.status === 'connected' && (
          <p className="store-status small muted">Saving to folder “{folder.name}”</p>
        )}
        {folder.status === 'error' && (
          <p className="store-status small">
            Couldn't save to the folder. Entries are kept in this browser.{' '}
            <button className="link small" onClick={reconnect}>Retry</button>
          </p>
        )}
      </aside>

      <main className="editor">
        <header className="topbar">
          <button className="btn ghost mobile-only" onClick={() => setShowList(true)}>
            ← Entries
          </button>
          <div className="spacer" />
          <button
            className="btn ghost"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀ Light' : '☾ Dark'}
          </button>
          {view === 'write' && selected && <button className="btn ghost" onClick={() => remove()}>Delete</button>}
          {view === 'write' && selected && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          )}
          {view === 'write' && selected && editing && !opensInEditor(selected) && (
            <button className="btn" onClick={() => setEditing(false)}>Done</button>
          )}
          <button className="btn mobile-only" onClick={create}>New</button>
        </header>

        {view === 'settings' && (
          <StorageSettings
            user={user}
            folder={folder}
            onChoose={chooseFolder}
            onBrowser={switchToBrowser}
            onReload={() => rootDirRef.current && connect(rootDirRef.current, false)}
          />
        )}

        {view === 'mood' && (
          <MoodChart entries={entries.filter((e) => !isEmpty(e))} moods={MOODS} onOpen={select} />
        )}

        {view === 'write' && selected && !editing && (
          <article className="page reading">
            <p className="date">
              {fmtLong(selected.createdAt)} <span className="muted">· {fmtTime(selected.createdAt)}</span>
            </p>
            <h1 className="read-title">{entryTitle(selected)}</h1>
            {selected.mood && <p className="read-mood">Feeling <span className="chip on">{selected.mood}</span></p>}
            <PhotoGallery ids={selected.photos} />
            <div className="read-body">
              {selected.body.trim() ||
                (selected.photos?.length ? null : <span className="muted">Nothing written in this entry.</span>)}
            </div>
            <footer className="status muted small">
              {words} {words === 1 ? 'word' : 'words'}
              {selected.photos?.length ? <> · {photoCount(selected.photos.length)}</> : null}
              {selected.updatedAt.slice(0, 16) !== selected.createdAt.slice(0, 16) && (
                <> · Last edited {fmtShort(selected.updatedAt)}, {fmtTime(selected.updatedAt)}</>
              )}
            </footer>
          </article>
        )}

        {view === 'write' && selected && editing && (
          <article className="page">
            <p className="date date-edit">
              <label>
                <span className="sr-only">Entry date</span>
                <input
                  type="date"
                  value={dateValue(selected.createdAt)}
                  max={dateValue(new Date().toISOString())}
                  onChange={(e) => changeDate(e.target.value)}
                />
              </label>
              <span className="muted">{fmtLong(selected.createdAt)} · {fmtTime(selected.createdAt)}</span>
            </p>

            <input
              className="title"
              placeholder="Title"
              value={selected.title}
              onChange={(e) => update({ title: e.target.value })}
            />

            <div className="moods" role="group" aria-label="How are you feeling?">
              <span className="muted small">Feeling</span>
              {MOODS.map((m) => (
                <button
                  key={m}
                  className={`chip ${selected.mood === m ? 'on' : ''}`}
                  aria-pressed={selected.mood === m}
                  onClick={() => update({ mood: selected.mood === m ? '' : m })}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="photo-bar">
              <span className="muted small">Wrote it on paper?</span>
              <label className="btn small-btn">
                Take photo
                <input type="file" accept="image/*" capture="environment" onChange={addPhotos} hidden />
              </label>
              <label className="btn small-btn">
                Add photos
                <input type="file" accept="image/*" multiple onChange={addPhotos} hidden />
              </label>
              {adding && <span className="muted small">Adding…</span>}
            </div>
            <PhotoGallery ids={selected.photos} onRemove={removePhoto} />

            <textarea
              ref={bodyRef}
              className="body"
              placeholder={selected.photos?.length ? 'Add a note (optional)' : 'How are you feeling today?'}
              value={selected.body}
              onChange={(e) => update({ body: e.target.value })}
            />

            <footer className="status muted small">
              {words} {words === 1 ? 'word' : 'words'}
              {selected.photos?.length ? <> · {photoCount(selected.photos.length)}</> : null}
              {!isEmpty(selected) && <> · Saved {fmtTime(selected.updatedAt)}</>}
            </footer>
          </article>
        )}
      </main>

      {undo && (
        <div className="toast" role="status">
          <span>Deleted “{entryTitle(undo.entry)}”</span>
          <button className="toast-btn" onClick={undoDelete}>Undo</button>
        </div>
      )}
    </div>
  )
}

function StorageSettings({ user, folder, onChoose, onBrowser, onReload }) {
  const inFolder = folder.status === 'connected' || folder.status === 'error'
  return (
    <article className="page chart-page">
      <h1 className="chart-title">Storage</h1>
      <p className="muted chart-sub">Choose where {user.name}'s entries are kept.</p>

      <div className={`store-option ${!inFolder ? 'on' : ''}`}>
        <div>
          <h2 className="store-h">This browser {!inFolder && <span className="tag">In use</span>}</h2>
          <p className="muted small">
            The default. Entries stay in this browser on this computer. Use Backup now and then to keep a copy.
          </p>
        </div>
        {inFolder && <button className="btn small-btn" onClick={onBrowser}>Use this browser</button>}
      </div>

      <div className={`store-option ${inFolder ? 'on' : ''} ${!folderSupported ? 'disabled' : ''}`}>
        <div>
          <h2 className="store-h">A folder you choose {inFolder && <span className="tag">In use</span>}</h2>
          <p className="muted small">
            Each entry is saved as a Markdown file, with photos in an “attachments” folder. You can open the
            folder in Obsidian, or pick a folder that OneDrive or Google Drive syncs.
          </p>
          {inFolder && (
            <p className="small">
              Saving to <strong>{folder.name}</strong> / <strong>{user.dirName}</strong>
            </p>
          )}
          {!folderSupported && <p className="small">Needs Chrome or Edge on a computer.</p>}
        </div>
        {folderSupported && (
          <div className="store-actions">
            <button className="btn small-btn" onClick={onChoose}>
              {inFolder ? 'Change folder' : 'Choose folder'}
            </button>
            {inFolder && <button className="link small" onClick={onReload}>Reload from folder</button>}
          </div>
        )}
      </div>

      <p className="muted small">
        Your profile ID is <span className="mono">{user.id}</span>. Each person's entries go in their own
        subfolder, so several people can share one folder.
      </p>
    </article>
  )
}
