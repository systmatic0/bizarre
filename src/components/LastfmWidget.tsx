import { useCallback, useEffect, useRef, useState } from 'react'
import { activateTextTruncateScroll } from 'text-truncate-scroll'
import TiltCard from './TiltCard'

// text-truncate-scroll only scrolls a line while the pointer is over that
// exact line's own box (its generated CSS keys off :hover on the element
// itself), and only ever scrolls it once — to the end, then holds. To make
// hovering anywhere on the badge run one there-and-back cycle on both lines,
// this reads the transform/transition the library already computed for a
// line's :hover state (from the <style> tag it injects next to it, tagged
// text-truncate-style-for) and reapplies it itself — forward, hold, back —
// as plain inline styles on the inner spans, which take effect regardless of
// which part of the badge the real hover is on. No scroll math of our own:
// the library's own ResizeObserver keeps that style tag current, this just
// replays whatever it last computed.
function startLineOnce(line: HTMLElement | null, pending: number[]) {
  if (!line) return

  const elementClass = [...line.classList].find((c) => c.startsWith('text-truncate-scroll-element-'))
  const style = elementClass
    ? line.parentElement?.querySelector(`style[text-truncate-style-for="${elementClass}"]`)
    : null
  const css = style?.textContent ?? ''
  const transform = css.match(/transform:\s*([^;]*);/)?.[1]
  const transition = css.match(/transition:\s*([^;]*);/)?.[1]
  // Duration is baked into the transition string (e.g. "all 1.2s linear") —
  // pull it back out to know how long to wait for a leg to actually finish.
  const durationMs = transition ? parseFloat(transition.match(/([\d.]+)s/)?.[1] ?? '0') * 1000 : 0
  if (!transform || !transition || durationMs <= 0) return // nothing to scroll

  const span1 = line.firstElementChild as HTMLElement | null
  const span2 = span1?.firstElementChild as HTMLElement | null
  if (!span1 || !span2) return

  // Forward leg: only width: auto (not the base 100%) lets span2 grow past
  // the badge's edge, which is what the transform then reveals.
  span1.style.width = 'auto'
  span2.style.width = 'auto'
  span2.style.transition = transition
  span2.style.transform = transform

  pending.push(
    window.setTimeout(() => {
      // Back leg. Width stays auto for the glide itself — reintroducing the
      // 100% width mid-transition would let text-overflow: ellipsis start
      // truncating a still-moving line, the exact stutter fixed earlier this
      // session. Only once the glide is actually done (after durationMs) is
      // it safe to restore the real rest width, landing back on a properly
      // ellipsis-truncated line rather than a hard, dot-less crop from the
      // outer badge's own overflow: hidden. Nothing is scheduled after that —
      // one there-and-back cycle per hover, not a repeating loop.
      span2.style.transform = ''
      pending.push(
        window.setTimeout(() => {
          span1.style.width = ''
          span2.style.width = ''
        }, durationMs),
      )
    }, durationMs + SCROLL_END_DELAY_MS),
  )
}

// The library's own :hover-off is an instant snap (its base styles declare no
// transition), so clearing these back to '' immediately matches that exactly.
function resetLineHover(line: HTMLElement | null) {
  const span1 = line?.firstElementChild as HTMLElement | undefined
  const span2 = span1?.firstElementChild as HTMLElement | undefined
  if (span1) span1.style.width = ''
  if (span2) {
    span2.style.width = ''
    span2.style.transform = ''
    span2.style.transition = ''
  }
}

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
const POLL_INTERVAL_MS = 90_000
// Library default is 60px/s; slower reads more like a lyric crawl than a snap.
const SCROLL_SPEED = 25
// Base pause: before a hover first commits to scrolling, so a cursor just
// passing over the badge (e.g. reaching for the tilt) doesn't set it off
// immediately.
const SCROLL_DELAY_MS = 500
// Pause once scrolled to the end of a line, so there's time to read it before
// it reverses.
const SCROLL_END_DELAY_MS = SCROLL_DELAY_MS * 4

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
  const titleRef = useRef<HTMLParagraphElement | null>(null)
  const artistRef = useRef<HTMLParagraphElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const scrollDelayRef = useRef<number | null>(null)
  const cycleTimeoutsRef = useRef<number[]>([])

  const handleCardEnter = useCallback(() => {
    scrollDelayRef.current = window.setTimeout(() => {
      scrollDelayRef.current = null
      startLineOnce(titleRef.current, cycleTimeoutsRef.current)
      startLineOnce(artistRef.current, cycleTimeoutsRef.current)
    }, SCROLL_DELAY_MS)
  }, [])

  const handleCardLeave = useCallback(() => {
    if (scrollDelayRef.current !== null) {
      window.clearTimeout(scrollDelayRef.current)
      scrollDelayRef.current = null
    }
    cycleTimeoutsRef.current.forEach(window.clearTimeout)
    cycleTimeoutsRef.current = []
    resetLineHover(titleRef.current)
    resetLineHover(artistRef.current)
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

  useEffect(() => {
    return () => {
      if (scrollDelayRef.current !== null) window.clearTimeout(scrollDelayRef.current)
      cycleTimeoutsRef.current.forEach(window.clearTimeout)
    }
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

  // `key`s below remount the <p> per track so this re-activates each one.
  useEffect(() => {
    if (listening) activateTextTruncateScroll({ scrollSpeed: SCROLL_SPEED })
  }, [listening])

  if (!API_KEY || !USERNAME || (failed && !hasLoadedOnce) || !listening) return null

  return (
    <div className='music-widget music-widget--floating' ref={cardRef}>
      <TiltCard glareEnable={false} scale={1}>
        <div className='music-widget__shell'>
        <p className='music-widget__eyebrow'>
          <span className='music-widget__bars' aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
          Playlist
        </p>
        <p className='music-widget__title text-truncate-scroll' key={listening.name} ref={titleRef}>{listening.name}</p>
        <p className='music-widget__detail text-truncate-scroll' key={listening.artist} ref={artistRef}>{listening.artist}</p>
        </div>
      </TiltCard>
    </div>
  )
}

export default LastfmWidget
