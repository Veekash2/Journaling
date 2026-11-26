// Photos live in IndexedDB (browser storage with room for images);
// entries only keep the photo ids. Each photo is stored as a JPEG data URL.

const DB_NAME = 'journal-photos'
const STORE = 'photos'
let dbPromise

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const result = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(result?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const cache = new Map()

export async function getPhoto(id) {
  if (cache.has(id)) return cache.get(id)
  const url = await tx('readonly', (s) => s.get(id))
  if (url) cache.set(id, url)
  return url
}

export async function getPhotos(ids = []) {
  const out = {}
  for (const id of ids) {
    const url = await getPhoto(id)
    if (url) out[id] = url
  }
  return out
}

export async function putPhoto(id, dataUrl) {
  await tx('readwrite', (s) => s.put(dataUrl, id))
  cache.set(id, dataUrl)
}

export async function deletePhotos(ids = []) {
  if (!ids.length) return
  await tx('readwrite', (s) => ids.forEach((id) => s.delete(id)))
  ids.forEach((id) => cache.delete(id))
}

// Shrink a camera photo so pages stay readable but storage stays small
export function compressImage(file, maxSide = 1800, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read that image'))
    }
    img.src = url
  })
}
