import { useCallback, useEffect, useState } from 'react'
import TiltCard from './TiltCard'

type RecentTrack = {
  name: string
  artist: { '#text': string }
}

type RecentTracksResponse = {
  recenttracks?: {
    track?: RecentTrack | RecentTrack[]
  }
}

type Listening = {
  name: string
  artist: string
}

const API_KEY = import.meta.env.VITE_LASTFM_API_KEY as string | undefined
const USERNAME = import.meta.env.VITE_LASTFM_USERNAME as string | undefined
const PROFILE_URL = USERNAME ? `https://www.last.fm/user/${USERNAME}` : undefined
const POLL_INTERVAL_MS = 90_000

function normalize(track: RecentTrack): Listening {
  return {
    name: track.name,
    artist: track.artist['#text'],
  }
}

function LastfmWidget() {
  const [listening, setListening] = useState<Listening | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!API_KEY || !USERNAME) return

    try {
      const url = new URL('https://ws.audioscrobbler.com/2.0/')
      url.searchParams.set('method', 'user.getrecenttracks')
      url.searchParams.set('user', USERNAME)
      url.searchParams.set('api_key', API_KEY)
      url.searchParams.set('limit', '1')
      url.searchParams.set('format', 'json')

      const response = await fetch(url, { signal })
      if (!response.ok) throw new Error(`Last.fm request failed with ${response.status}`)

      const data = (await response.json()) as RecentTracksResponse
      const rawTrack = Array.isArray(data.recenttracks?.track)
        ? data.recenttracks.track[0]
        : data.recenttracks?.track

      if (!rawTrack) throw new Error('no scrobbles')

      setListening(normalize(rawTrack))
      setHasLoadedOnce(true)
    } catch {
      if (signal?.aborted) return
      // First load failed → widget stays hidden. Poll failure after success → keep last data.
      setFailed((wasFailed) => wasFailed || !hasLoadedOnce)
    }
  }, [hasLoadedOnce])

  useEffect(() => {
    if (!API_KEY || !USERNAME) return

    const controller = new AbortController()
    load(controller.signal)

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        load(controller.signal)
      }
    }, POLL_INTERVAL_MS)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        load(controller.signal)
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [load])

  if (!API_KEY || !USERNAME || (failed && !hasLoadedOnce) || !listening) return null

  return (
    <div className='music-widget music-widget--floating'>
      <TiltCard>
        <a
        className='music-widget__shell'
        href={PROFILE_URL}
        target='_blank'
        rel='noopener noreferrer'
        title='Open on Last.fm'
      >
        <p className='music-widget__eyebrow'>
          <span className='music-widget__bars' aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
          Playlist
        </p>
        <p className='music-widget__title'>{listening.name}</p>
        <p className='music-widget__detail'>{listening.artist}</p>
        </a>
      </TiltCard>
    </div>
  )
}

export default LastfmWidget
