import { useEffect, useState } from 'react'
import { toSvgPath, type LatLng } from './projectRoute'
import '../styles/Activity.css'

type Track = {
  id: number
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
const SVG_SIZE = 200
const SVG_PADDING = 12
const VISIBLE_COUNT = 6

function formatDistance(metres: number) {
  return `${(metres / 1000).toFixed(1)} km`
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function ActivityWidget() {
  const [tracks, setTracks] = useState<Track[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(DATA_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data) => setTracks(data.tracks ?? []))
      .catch(() => setTracks([]))

    return () => controller.abort()
  }, [])

  // Nothing to show before the first build with a key, and no point rendering
  // an empty shell if there are no GPS activities yet.
  if (!tracks?.length) return null

  return (
    <section className='activity' aria-label='Recent activity'>
      <p className='activity__header'>Recently moving</p>

      <div className='activity__grid'>
        {tracks.slice(0, VISIBLE_COUNT).map((track) => (
          <a
            key={track.id}
            className='activity__card'
            href={`https://intervals.icu/activities/${track.id}`}
            target='_blank'
            rel='noopener noreferrer'
          >
            <svg
              className='activity__map'
              viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
              role='img'
              aria-label={`Route of ${track.name}`}
            >
              <path d={toSvgPath(track.points, SVG_SIZE, SVG_PADDING)} />
            </svg>

            <div className='activity__meta'>
              <p className='activity__name'>{track.name}</p>
              <p className='activity__stats'>
                {formatDistance(track.distance)} · {formatDuration(track.movingTime)} ·{' '}
                {Math.round(track.elevationGain)} m
              </p>
              <p className='activity__date'>{formatDate(track.startDate)}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}

export default ActivityWidget
