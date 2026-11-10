import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import TiltCard from './TiltCard'
import { scrambleElementOnce } from './scrambleText'

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

type TopArtist = {
  name: string
  playcount: string
}

type TopArtistsResponse = {
  topartists?: {
    artist?: TopArtist | TopArtist[]
  }
}

const API_KEY = import.meta.env.VITE_LASTFM_API_KEY as string | undefined
const USERNAME = import.meta.env.VITE_LASTFM_USERNAME as string | undefined
const PROFILE_URL = USERNAME ? `https://www.last.fm/user/${USERNAME}` : undefined
const POLL_INTERVAL_MS = 90_000
const TOP_ARTISTS_LIMIT = 5
// Last.fm's period values aren't plain day counts — "1month" is its nearest
// bucket to a rolling 30 days.
const TOP_ARTISTS_PERIOD = '1month'
// Constant px/s rather than a fixed animation-duration: a long "song - artist"
// string should glide past at the same speed a short one does, not finish its
// loop in the same wall-clock time.
const MARQUEE_SPEED = 25
// How long the popover waits, after the cursor actually arrives or leaves,
// before it opens or closes — long enough that passing over or near the
// badge on the way elsewhere doesn't read as an open-close flicker. Closing
// waits longer: an accidental close (interrupting whatever the popover was
// showing) is more disruptive than an accidental open.
const EXPAND_DELAY_MS = 120
const COLLAPSE_DELAY_MS = 250

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
  const [topArtists, setTopArtists] = useState<TopArtist[] | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  // Seconds for one loop of the marquee track — null until the item's been
  // measured, which the marquee stays paused for (see the effect below) so
  // it doesn't render one frame at the browser's CSS-default duration first.
  const [marqueeDuration, setMarqueeDuration] = useState<number | null>(null)
  // Whether the track title actually needs to scroll — a short "song -
  // artist" that already fits the badge just sits there still, rather than
  // looping pointlessly (and rather than rendering the duplicated second
  // copy the loop needs, which would otherwise just sit visible next to it).
  const [isMarqueeOverflowing, setIsMarqueeOverflowing] = useState(false)
  const marqueeRef = useRef<HTMLDivElement | null>(null)
  const marqueeItemRef = useRef<HTMLSpanElement | null>(null)
  const expandRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Both directions wait a beat rather than firing the instant the cursor
  // crosses the edge — without it, a cursor merely passing over or near the
  // badge on its way elsewhere opened and shut the popover on every twitch.
  // One ref for both: opening and closing can't both be pending at once, so
  // whichever fires later just cancels whatever the other queued.
  const expandTimeoutRef = useRef<number | null>(null)

  const clearPendingExpand = () => {
    if (expandTimeoutRef.current === null) return
    window.clearTimeout(expandTimeoutRef.current)
    expandTimeoutRef.current = null
  }

  const handleCardEnter = useCallback(() => {
    clearPendingExpand()
    expandTimeoutRef.current = window.setTimeout(() => {
      expandTimeoutRef.current = null
      setIsExpanded(true)
    }, EXPAND_DELAY_MS)
  }, [])

  const handleCardLeave = useCallback(() => {
    clearPendingExpand()
    expandTimeoutRef.current = window.setTimeout(() => {
      expandTimeoutRef.current = null
      setIsExpanded(false)
    }, COLLAPSE_DELAY_MS)
  }, [])

  useEffect(() => clearPendingExpand, [])

  // Touch has no hover, so mouseenter alone can open the popover (most mobile
  // browsers synthesize it on a first tap) but nothing ever fires mouseleave
  // to close it again until some other element gets tapped. A tap on the
  // badge itself needs to toggle it directly. Runs after any synthesized
  // mouseenter above (same tick, before its EXPAND_DELAY_MS timeout), so it
  // safely overrides whatever that scheduled. Skipped on hover-capable
  // devices, where a click shouldn't fight with the hover state, and skipped
  // for the footer link so tapping it navigates instead of just closing the
  // popover.
  const handleCardClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (window.matchMedia('(hover: none)').matches === false) return
    if ((event.target as HTMLElement).closest('a')) return

    clearPendingExpand()
    setIsExpanded((expanded) => !expanded)
  }, [])

  // Native listeners rather than React's onMouseEnter/onMouseLeave props.
  // React synthesises those from delegated mouseover/mouseout at the root, and
  // for a move between two elements in its own tree it deliberately handles
  // the pair from the mouseout side — a mouseover whose relatedTarget is
  // already React-managed is skipped as a duplicate. Home.tsx stops exactly
  // that mouseout in its capture phase (so moving off the hero canvas onto a
  // badge doesn't reset the Rive hologram), which left React with a mouseover
  // it skips and an out-event it never saw: coming onto this badge from the
  // hero, the expand simply never fired. mouseenter/mouseleave are dispatched
  // straight to this element and don't bubble, so that swallow can't reach
  // them.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    el.addEventListener('mouseenter', handleCardEnter)
    el.addEventListener('mouseleave', handleCardLeave)

    return () => {
      el.removeEventListener('mouseenter', handleCardEnter)
      el.removeEventListener('mouseleave', handleCardLeave)
    }
  }, [handleCardEnter, handleCardLeave, listening])

  // react-parallax-tilt only measures the card once — on mouseenter, and
  // again on window resize — and caches that size for both the tilt math and
  // the glare overlay it draws on top. It has no idea our own expand
  // animation is about to change the card's actual height, so it measures
  // the still-compact box right as the hover starts, then never again: the
  // glare (and the geometry the tilt itself uses) stays pinned to the old,
  // smaller size for the rest of the hover — visible as a mismatched square
  // rotating inside the now-taller card. Firing a resize event is the only
  // hook the library exposes to make it re-measure; doing it once the
  // grid-template-rows transition actually finishes (both growing and
  // shrinking) covers the size it'll be sitting at for the rest of the hover.
  useEffect(() => {
    const el = expandRef.current
    if (!el) return

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'grid-template-rows') window.dispatchEvent(new Event('resize'))
    }

    el.addEventListener('transitionend', handleTransitionEnd)
    return () => el.removeEventListener('transitionend', handleTransitionEnd)
  }, [])

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

  // Measures one copy's rendered width (including the trailing gap) to turn
  // a constant px/s speed into a duration — layout effect, not a plain one,
  // so the animation is sized before the browser paints the first frame
  // rather than visibly starting at some default speed and then jumping.
  useLayoutEffect(() => {
    const item = marqueeItemRef.current
    const track = marqueeRef.current
    if (!item || !track) return

    const itemWidth = item.getBoundingClientRect().width
    const overflowing = itemWidth > track.getBoundingClientRect().width
    setIsMarqueeOverflowing(overflowing)
    setMarqueeDuration(overflowing ? itemWidth / MARQUEE_SPEED : null)
  }, [listening])

  // Fetched once — a 30-day ranking doesn't shift on the same 90s cadence
  // the current track does, so it isn't tied to that poll.
  useEffect(() => {
    if (!API_KEY || !USERNAME) return

    const controller = new AbortController()

    const url = new URL('https://ws.audioscrobbler.com/2.0/')
    url.searchParams.set('method', 'user.getTopArtists')
    url.searchParams.set('user', USERNAME)
    url.searchParams.set('api_key', API_KEY)
    url.searchParams.set('period', TOP_ARTISTS_PERIOD)
    url.searchParams.set('limit', String(TOP_ARTISTS_LIMIT))
    url.searchParams.set('format', 'json')

    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: TopArtistsResponse) => {
        const artists = data.topartists?.artist
        setTopArtists(Array.isArray(artists) ? artists : artists ? [artists] : [])
      })
      .catch(() => setTopArtists(null))

    return () => controller.abort()
  }, [])

  if (!API_KEY || !USERNAME || (failed && !hasLoadedOnce) || !listening) return null

  const nowPlaying = `${listening.name} - ${listening.artist}`

  return (
    <div
      className={`music-widget music-widget--floating${isExpanded ? ' is-expanded' : ''}`}
      ref={cardRef}
      onClick={handleCardClick}
    >
      {/* See the matching comment in ActivityWidget.tsx — same bump, for the
          same reason: the default 12deg reads as barely-there on the
          expanded popover. */}
      <TiltCard glareEnable={false} scale={1} maxAngle={16}>
        <div className='music-widget__shell'>
        <p className='music-widget__eyebrow'>
          <span className='music-widget__bars' aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
          Recent track
        </p>
        <div className='music-widget__marquee' aria-label={nowPlaying} ref={marqueeRef}>
          {/* key remounts on track change, so the new copy's animation
              starts fresh from the left rather than continuing mid-loop
              from wherever the previous track's happened to be. */}
          <div
            className={`music-widget__marquee-track${isMarqueeOverflowing ? '' : ' music-widget__marquee-track--static'}`}
            key={nowPlaying}
            style={marqueeDuration ? { animationDuration: `${marqueeDuration}s` } : undefined}
          >
            <span className='music-widget__marquee-item' ref={marqueeItemRef} aria-hidden='true'>
              {nowPlaying}
            </span>
            {/* Same text again, right after the first (padding-right in CSS
                is the gap) — the loop animates exactly one copy's width, so
                this one slides into view as the first slides out, seamlessly.
                Only needed once it's actually scrolling — a title that
                already fits has nowhere for a second copy to hide. */}
            {isMarqueeOverflowing && (
              <span className='music-widget__marquee-item' aria-hidden='true'>
                {nowPlaying}
              </span>
            )}
          </div>
        </div>

        <div className='music-widget__expand' ref={expandRef}>
          <div className='music-widget__expand-inner'>
            {topArtists && topArtists.length > 0 && (
              <>
                <p className='music-widget__expand-heading'>Top artists · 30 days</p>
                <ol className='music-widget__expand-artists'>
                  {topArtists.map((artist) => (
                    <li
                      className='music-widget__expand-artist'
                      key={artist.name}
                      onMouseEnter={(event) => scrambleElementOnce(event.currentTarget)}
                    >
                      {artist.name}
                    </li>
                  ))}
                </ol>
              </>
            )}
            <a
              className='music-widget__expand-footer'
              href={PROFILE_URL}
              target='_blank'
              rel='noopener noreferrer'
            >
              View on Last.fm
            </a>
          </div>
        </div>
        </div>
      </TiltCard>
    </div>
  )
}

export default LastfmWidget
