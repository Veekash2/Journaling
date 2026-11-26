import { useMemo, useState } from 'react'

const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
]

const DAY = 86400000
const dayKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const startOfDay = (d) => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
const fmt = (d, opts) => new Date(d).toLocaleDateString(undefined, opts)

export default function MoodChart({ entries, moods, onOpen }) {
  const [range, setRange] = useState('30')
  const [tip, setTip] = useState(null)

  const data = useMemo(() => {
    const today = startOfDay(new Date())
    const r = RANGES.find((x) => x.key === range)
    const withMood = entries.filter((e) => e.mood)
    let start
    if (r.days) start = new Date(today.getTime() - (r.days - 1) * DAY)
    else {
      const first = withMood.reduce((m, e) => (e.createdAt < m ? e.createdAt : m), today.toISOString())
      start = startOfDay(first)
    }
    const inRange = entries.filter((e) => new Date(e.createdAt) >= start)
    const moodEntries = inRange.filter((e) => e.mood)

    const counts = Object.fromEntries(moods.map((m) => [m, 0]))
    for (const e of moodEntries) if (e.mood in counts) counts[e.mood]++
    const max = Math.max(1, ...Object.values(counts))
    const top = moods.reduce((a, b) => (counts[b] > counts[a] ? b : a), moods[0])

    // Timeline: one column per day (or per week when the range is long)
    const totalDays = Math.round((today - start) / DAY) + 1
    const step = totalDays > 120 ? 7 : 1
    const cols = Math.ceil(totalDays / step)
    const cells = new Map() // `${mood}|${col}` -> entries
    for (const e of moodEntries) {
      const col = Math.floor((startOfDay(e.createdAt) - start) / DAY / step)
      const k = `${e.mood}|${col}`
      if (!cells.has(k)) cells.set(k, [])
      cells.get(k).push(e)
    }
    const days = new Set(inRange.map((e) => dayKey(e.createdAt))).size

    return { start, today, counts, max, top, cols, step, cells, moodEntries, inRange, days }
  }, [entries, moods, range])

  const showTip = (ev, text) => setTip({ x: ev.clientX, y: ev.clientY, text })
  const hideTip = () => setTip(null)

  const empty = data.moodEntries.length === 0

  // Timeline geometry (SVG units)
  const LABEL_W = 76
  const ROW_H = 26
  const W = 600
  const plotW = W - LABEL_W
  const colW = plotW / data.cols
  const H = moods.length * ROW_H + 22
  const colDate = (c) => new Date(data.start.getTime() + c * data.step * DAY)
  const tickEvery = Math.max(1, Math.ceil(data.cols / 6))

  return (
    <article className="page chart-page">
      <h1 className="chart-title">Mood</h1>
      <p className="muted chart-sub">How you've been feeling, from the moods you tag on entries.</p>

      <div className="segmented" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            className={range === r.key ? 'on' : ''}
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="stats">
        <div className="stat">
          <span className="stat-label">Most felt</span>
          <span className="stat-value">{empty ? '—' : data.top}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Entries</span>
          <span className="stat-value">{data.inRange.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Days journaled</span>
          <span className="stat-value">{data.days}</span>
        </div>
      </div>

      {empty ? (
        <p className="muted chart-empty">
          No moods tagged in this period yet. Pick a feeling on an entry and it will show up here.
        </p>
      ) : (
        <>
          <section className="chart-block">
            <h2 className="chart-h">How often you felt each</h2>
            <div className="bars" role="table" aria-label="Mood counts">
              {moods.map((m) => {
                const n = data.counts[m]
                const pct = Math.round((n / data.moodEntries.length) * 100)
                return (
                  <div
                    key={m}
                    className="bar-row"
                    role="row"
                    onMouseMove={(ev) => showTip(ev, `${m}: ${n} ${n === 1 ? 'entry' : 'entries'} (${pct}%)`)}
                    onMouseLeave={hideTip}
                  >
                    <span className="bar-label" role="rowheader">{m}</span>
                    <span className="bar-track" role="cell">
                      {n > 0 && <span className="bar" style={{ width: `${(n / data.max) * 100}%` }} />}
                    </span>
                    <span className="bar-value" role="cell">{n}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="chart-block">
            <h2 className="chart-h">
              {data.step === 1 ? 'Day by day' : 'Week by week'}
            </h2>
            <svg
              className="timeline"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={`Moods logged ${data.step === 1 ? 'per day' : 'per week'}`}
            >
              {moods.map((m, i) => (
                <g key={m}>
                  <line
                    x1={LABEL_W} x2={W} y1={i * ROW_H + ROW_H / 2} y2={i * ROW_H + ROW_H / 2}
                    className="tl-grid"
                  />
                  <text x={0} y={i * ROW_H + ROW_H / 2} dy="0.35em" className="tl-label">{m}</text>
                </g>
              ))}
              {Array.from({ length: data.cols }, (_, c) =>
                c % tickEvery === 0 ? (
                  <text key={c} x={LABEL_W + c * colW + colW / 2} y={H - 4} className="tl-tick" textAnchor="middle">
                    {fmt(colDate(c), { day: 'numeric', month: 'short' })}
                  </text>
                ) : null
              )}
              {moods.flatMap((m, i) =>
                Array.from({ length: data.cols }, (_, c) => {
                  const list = data.cells.get(`${m}|${c}`)
                  if (!list) return null
                  const cx = LABEL_W + c * colW + colW / 2
                  const cy = i * ROW_H + ROW_H / 2
                  const when =
                    data.step === 1
                      ? fmt(colDate(c), { weekday: 'short', day: 'numeric', month: 'short' })
                      : `Week of ${fmt(colDate(c), { day: 'numeric', month: 'short' })}`
                  const titles = list.map((e) => e.title || 'Untitled').slice(0, 3).join(', ')
                  return (
                    <g
                      key={`${m}-${c}`}
                      className="tl-hit"
                      onMouseMove={(ev) => showTip(ev, `${when} · ${m}${list.length > 1 ? ` ×${list.length}` : ''} — ${titles}`)}
                      onMouseLeave={hideTip}
                      onClick={() => onOpen(list[0].id)}
                    >
                      <rect x={cx - Math.max(colW, 12) / 2} y={cy - ROW_H / 2} width={Math.max(colW, 12)} height={ROW_H} fill="transparent" />
                      <circle cx={cx} cy={cy} r={Math.min(6, 4 + list.length)} className="tl-dot" />
                    </g>
                  )
                })
              )}
            </svg>
            <p className="muted small">Click a dot to open that entry.</p>
          </section>
        </>
      )}

      {tip && (
        <div className="tooltip" style={{ left: tip.x + 12, top: tip.y + 12 }}>
          {tip.text}
        </div>
      )}
    </article>
  )
}
