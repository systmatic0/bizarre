import { useEffect, useState } from 'react'
import { toSvgPath, type LatLng } from './projectRoute'
import '../styles/Activity.css'

type Track = {
  id: string | number
  name: string
  type: string
  distance: number
  movingTime: number
  elevationGain: number
  startDate: string
  points: LatLng[]
}

// public/activities.json is written at build time by scripts/fetch-activities.mjs.
const DATA_URL = '/activities.json'
const SVG_SIZE = 100
const SVG_PADDING = 6

function ActivityWidget() {
  const [track, setTrack] = useState<Track | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(DATA_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: { tracks?: Track[] }) => {
        // The feed arrives newest-first, but sort rather than trust it.
        const [latest] = (data.tracks ?? [])
          .filter((candidate) => candidate.points?.length > 1)
          .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))

        setTrack(latest ?? null)
      })
      .catch(() => setTrack(null))

    return () => controller.abort()
  }, [])

  // Stay hidden until there's a route to draw, matching how the Last.fm badge
  // behaves when there's nothing playing.
  if (!track) return null

  return (
    <div className='activity-badge activity-badge--floating'>
      <div className='activity-badge__shell'>
        <svg
          className='activity-badge__map'
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
          role='img'
          aria-label={`Route of ${track.name}`}
        >
          <path d={toSvgPath(track.points, SVG_SIZE, SVG_PADDING)} />
        </svg>

        <p className='activity-badge__title'>Recent track</p>
      </div>
    </div>
  )
}

export default ActivityWidget
