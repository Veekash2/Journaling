// Builds a plain, text-based PDF of every entry (oldest first) so it can be
// read by people or handed to an AI for analysis.

// The built-in PDF fonts only cover Western European characters, so swap
// common typographic characters and drop anything else (e.g. emoji).
function clean(s) {
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\n\t\x20-\x7E\xA0-\xFF]/g, '')
}

export async function exportPdf(entries, moods, loadPhotos) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 56
  const textW = W - M * 2
  let y = M

  const ensure = (h) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const write = (text, { size = 11, style = 'normal', font = 'times', gap = 4, color = 0 } = {}) => {
    doc.setFont(font, style)
    doc.setFontSize(size)
    doc.setTextColor(color)
    const lh = size * 1.4
    for (const line of doc.splitTextToSize(clean(text), textW)) {
      ensure(lh)
      doc.text(line, M, y + size)
      y += lh
    }
    y += gap
  }
  const rule = () => {
    ensure(16)
    doc.setDrawColor(200)
    doc.line(M, y + 6, W - M, y + 6)
    y += 18
  }

  const sorted = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const d = (iso, o) => new Date(iso).toLocaleDateString('en-GB', o)
  const long = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  const time = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Cover / summary
  write('Journal', { size: 26, gap: 2 })
  write(`Exported ${d(new Date().toISOString(), long)}`, { size: 10, font: 'helvetica', color: 110, gap: 14 })

  const counts = moods.map((m) => [m, sorted.filter((e) => e.mood === m).length]).filter(([, n]) => n)
  const summary = [
    `Entries: ${sorted.length}`,
    sorted.length ? `Period: ${d(sorted[0].createdAt, long)} to ${d(sorted.at(-1).createdAt, long)}` : '',
    `Entries with a mood tagged: ${sorted.filter((e) => e.mood).length}`,
    `Photos of handwritten pages: ${sorted.reduce((n, e) => n + (e.photos?.length || 0), 0)}`,
    counts.length ? `Mood counts: ${counts.map(([m, n]) => `${m} ${n}`).join(', ')}` : '',
  ].filter(Boolean)
  for (const line of summary) write(line, { size: 10, font: 'helvetica', gap: 1 })
  y += 8
  rule()

  // Entries
  for (const e of sorted) {
    const photos = e.photos?.length && loadPhotos ? await loadPhotos(e.photos) : {}
    const urls = (e.photos || []).map((id) => photos[id]).filter(Boolean)
    const maxH = H - M * 2 - 110 // leaves room for the entry heading above a photo
    const fit = (url) => {
      const { width, height } = doc.getImageProperties(url)
      const scale = Math.min(textW / width, maxH / height)
      return { w: width * scale, h: height * scale }
    }
    // Keep the heading on the same page as the first photo when there's no text
    ensure(urls.length && !e.body.trim() ? fit(urls[0]).h + 90 : 60)
    const meta = `${d(e.createdAt, long)}, ${time(e.createdAt)}${e.mood ? `  |  Mood: ${e.mood}` : ''}`
    write(meta, { size: 9, font: 'helvetica', style: 'bold', color: 90, gap: 2 })
    write(e.title || (urls.length ? 'Handwritten entry' : 'Untitled'), { size: 15, gap: 4 })
    if (e.body.trim()) write(e.body.trim(), { size: 11, gap: 2 })
    for (const [i, url] of urls.entries()) {
      const { w, h } = fit(url)
      ensure(h + 24)
      doc.addImage(url, 'JPEG', M + (textW - w) / 2, y + 6, w, h)
      y += h + 10
      write(`Photo ${i + 1} of ${urls.length}`, { size: 8, font: 'helvetica', color: 140, gap: 4 })
    }
    rule()
  }

  // Page numbers
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`${i} / ${pages}`, W - M, H - 28, { align: 'right' })
  }

  doc.save(`journal-${new Date().toISOString().slice(0, 10)}.pdf`)
}
