import { useState } from 'react'
import App from './App.jsx'
import {
  createUser,
  deleteUserData,
  entriesKey,
  hasLegacyEntries,
  loadCurrentId,
  loadUsers,
  saveCurrentId,
  saveUsers,
} from './users.js'
import { deletePhotos } from './photos.js'
import { forgetFolder } from './folder.js'

export default function Root() {
  const [users, setUsers] = useState(loadUsers)
  const [currentId, setCurrentId] = useState(() => {
    const saved = loadCurrentId()
    const list = loadUsers()
    return list.some((u) => u.id === saved) ? saved : list[0]?.id ?? null
  })
  const [showProfiles, setShowProfiles] = useState(false)

  const current = users.find((u) => u.id === currentId)

  function add(name) {
    const user = createUser(name, users)
    const next = [...users, user]
    setUsers(next)
    saveUsers(next)
    switchTo(user.id)
  }

  function switchTo(id) {
    setCurrentId(id)
    saveCurrentId(id)
    setShowProfiles(false)
  }

  function remove(user) {
    const msg =
      `Delete ${user.name}'s profile and all their entries stored in this browser? This cannot be undone.` +
      '\n\nFiles already saved to a folder are not deleted.'
    if (!window.confirm(msg)) return
    try {
      const entries = JSON.parse(localStorage.getItem(entriesKey(user.id)) || '[]')
      deletePhotos(entries.flatMap((e) => e.photos || []))
    } catch {
      /* ignore */
    }
    deleteUserData(user.id)
    forgetFolder(user.id).catch(() => {})
    const next = users.filter((u) => u.id !== user.id)
    setUsers(next)
    saveUsers(next)
    if (user.id === currentId) {
      setCurrentId(next[0]?.id ?? null)
      saveCurrentId(next[0]?.id ?? null)
    }
  }

  if (!current) return <Welcome onCreate={add} legacy={hasLegacyEntries()} />

  return (
    <>
      <App key={current.id} user={current} onProfiles={() => setShowProfiles(true)} />
      {showProfiles && (
        <Profiles
          users={users}
          currentId={currentId}
          onSwitch={switchTo}
          onAdd={add}
          onDelete={remove}
          onClose={() => setShowProfiles(false)}
        />
      )}
    </>
  )
}

function NameForm({ onSubmit, cta, autoFocus }) {
  const [name, setName] = useState('')
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onSubmit(name)
        setName('')
      }}
    >
      <input
        className="search"
        placeholder="Your name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        autoFocus={autoFocus}
        aria-label="Name"
      />
      <button className="btn primary" disabled={!name.trim()}>{cta}</button>
    </form>
  )
}

function Welcome({ onCreate, legacy }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1 className="chart-title">Journal</h1>
        <p className="muted">
          Who's writing? Each person gets their own private profile on this computer.
        </p>
        <NameForm onSubmit={onCreate} cta="Start journaling" autoFocus />
        {legacy && <p className="muted small">Your existing entries will move into this profile.</p>}
      </div>
    </div>
  )
}

function Profiles({ users, currentId, onSwitch, onAdd, onDelete, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Profiles" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Profiles</h2>
          <button className="btn ghost" onClick={onClose}>Close</button>
        </div>
        <ul className="profile-list">
          {users.map((u) => (
            <li key={u.id} className={u.id === currentId ? 'current' : ''}>
              <div className="profile-info">
                <span className="profile-name">{u.name}</span>
                <span className="muted small mono">ID {u.id}</span>
              </div>
              {u.id === currentId ? (
                <span className="muted small">Current</span>
              ) : (
                <button className="btn small-btn" onClick={() => onSwitch(u.id)}>Switch</button>
              )}
              <button className="link small" onClick={() => onDelete(u)}>Delete</button>
            </li>
          ))}
        </ul>
        <h3 className="chart-h">Add a person</h3>
        <NameForm onSubmit={onAdd} cta="Add" />
        <p className="muted small">
          Profiles keep journals apart but have no password. Anyone using this computer can switch profiles.
        </p>
      </div>
    </div>
  )
}
