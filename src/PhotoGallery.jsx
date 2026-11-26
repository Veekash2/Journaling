import { useEffect, useState } from 'react'
import { getPhotos } from './photos.js'

export default function PhotoGallery({ ids = [], onRemove }) {
  const [urls, setUrls] = useState({})
  const [open, setOpen] = useState(null)
  const key = ids.join(',')

  useEffect(() => {
    let alive = true
    getPhotos(ids).then((u) => alive && setUrls(u))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!ids.length) return null

  return (
    <>
      <div className="gallery">
        {ids.map((id, i) => (
          <figure key={id} className="photo">
            {urls[id] ? (
              <button className="photo-open" onClick={() => setOpen(id)} aria-label={`View photo ${i + 1}`}>
                <img src={urls[id]} alt={`Journal page ${i + 1}`} />
              </button>
            ) : (
              <div className="photo-loading" />
            )}
            {onRemove && (
              <button className="photo-remove" onClick={() => onRemove(id)} aria-label={`Remove photo ${i + 1}`}>
                ×
              </button>
            )}
          </figure>
        ))}
      </div>

      {open && urls[open] && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label="Photo">
          <img src={urls[open]} alt="Journal page, full size" />
          <span className="lightbox-hint">Click anywhere or press Esc to close</span>
        </div>
      )}
    </>
  )
}
