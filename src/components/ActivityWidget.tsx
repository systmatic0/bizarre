import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { computeBounds, largestCluster, latLngBounds, projectPath, toSvgPath, type LatLng } from './projectRoute'
import TiltCard from './TiltCard'
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

// scripts/fetch-elevation.mjs already stitches marching squares' raw
// per-cell segments into continuous polylines per level, so each `line` here
// is ready to run through the same projectPath (and its Catmull-Rom
// smoothing) the GPS tracks use.
type ContourLevel = { elevation: number; lines: LatLng[][] }
type Topo = { levels: ContourLevel[] }

// public/activities.json and public/topo.json are written at build time by
// scripts/fetch-activities.mjs and scripts/fetch-elevation.mjs.
const DATA_URL = '/activities.json'
const TOPO_URL = '/topo.json'
const SVG_SIZE = 100
const SVG_PADDING = 6
// The combined map gets more room than the compact icon, so close-together
// routes still read as separate lines rather than one blur.
const MAP_SVG_SIZE = 200
const MAP_SVG_PADDING = 10
const GRID_SPACING = 10
// How long the popover waits, after the cursor actually arrives or leaves,
// before it opens or closes — long enough that passing over or near the
// badge on the way elsewhere doesn't read as an open-close flicker. Closing
// waits longer: an accidental close (interrupting whatever the popover was
// showing) is more disruptive than an accidental open.
const EXPAND_DELAY_MS = 120
const COLLAPSE_DELAY_MS = 250

function ActivityWidget() {
  const [track, setTrack] = useState<Track | null>(null)
  // All tracks the build script pulled, newest first — the popover overlays
  // every one of them on a single shared map (the `bounds` below pools every
  // track's points into one bounding box, so a route in Keila and one in
  // Saue land at their true positions relative to each other, and nothing
  // outside that combined box — e.g. Tallinn — gets pulled in).
  const [tracks, setTracks] = useState<Track[]>([])
  const [topo, setTopo] = useState<Topo | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const expandRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetch(DATA_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: { tracks?: Track[] }) => {
        // The feed arrives newest-first, but sort rather than trust it.
        const sorted = (data.tracks ?? [])
          .filter((candidate) => candidate.points?.length > 1)
          .sort((a, b) => Date.parse(b.startDate) - Date.parse(a.startDate))

        setTracks(sorted)
        setTrack(sorted[0] ?? null)
      })
      .catch(() => {
        setTrack(null)
        setTracks([])
      })

    return () => controller.abort()
  }, [])

  // Real elevation contours for the same area the tracks cover — optional:
  // a fork without an OpenTopoData fetch, or terrain too flat to contour,
  // just leaves topo.json's levels empty, and the map draws without them.
  useEffect(() => {
    const controller = new AbortController()

    fetch(TOPO_URL, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: Topo) => setTopo(data))
      .catch(() => setTopo(null))

    return () => controller.abort()
  }, [])

  // Only tracks near each other share the map — a route from a different
  // city entirely would blow out the bounding box and squeeze the rest into
  // a corner, so it's dropped from this view rather than pooled in.
  const mapTracks = useMemo(
    () => largestCluster(tracks.map((item) => item.points)).map((index) => tracks[index]),
    [tracks],
  )
  // Computed once and reused for both the tracks and the contour lines below,
  // so an elevation grid sampled independently of any track still lands in
  // exactly the same pixel space as the routes drawn over it.
  const bounds = useMemo(
    () => (mapTracks.length > 1 ? computeBounds(mapTracks.flatMap((item) => item.points), MAP_SVG_SIZE, MAP_SVG_PADDING) : null),
    [mapTracks],
  )
  const combinedPaths = useMemo(
    () => (bounds ? mapTracks.map((item) => projectPath(item.points, bounds, MAP_SVG_SIZE, MAP_SVG_PADDING)) : []),
    [mapTracks, bounds],
  )
  // Each stitched line gets the exact same treatment as a track: projected
  // into the shared bounds and run through the Catmull-Rom smoothing
  // projectPath already applies, so a contour reads as a curve rather than
  // the grid's own straight cell edges. A level's several lines are joined
  // into one `d` — each already starts with its own "M", so concatenating
  // them keeps them as separate subpaths within one <path> element.
  const contourLevels = useMemo(() => {
    if (!bounds || !topo) return []

    return topo.levels.map((level) => ({
      elevation: level.elevation,
      d: level.lines.map((line) => projectPath(line, bounds, MAP_SVG_SIZE, MAP_SVG_PADDING)).join(' '),
    }))
  }, [bounds, topo])
  // The corner labels below read straight off these — the raw lat/lng
  // extremes of the tracks actually on the map, not some fixed regional box.
  const mapBounds = useMemo(
    () => (mapTracks.length > 1 ? latLngBounds(mapTracks.flatMap((item) => item.points)) : null),
    [mapTracks],
  )
  const gridPatternId = useId()

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

  // Native listeners rather than React's onMouseEnter/onMouseLeave props —
  // see the matching comment on LastfmWidget for why (a capture-phase
  // mouseout swallow elsewhere in the hero leaves React's synthetic events
  // unreliable for badges entered from the canvas).
  useEffect(() => {
    const el = cardRef.current
    if (!el) return

    el.addEventListener('mouseenter', handleCardEnter)
    el.addEventListener('mouseleave', handleCardLeave)

    return () => {
      el.removeEventListener('mouseenter', handleCardEnter)
      el.removeEventListener('mouseleave', handleCardLeave)
    }
  }, [handleCardEnter, handleCardLeave, track])

  // Same fix as the Last.fm badge: react-parallax-tilt caches its measured
  // size at mouseenter and only re-measures on window resize, so it never
  // notices the popover growing the card underneath it. Both dimensions
  // animate at once here (grid-template-rows on the inner expand element,
  // width on the outer floating card), so both need to trigger a re-measure.
  // Depends on mapTracks/mapBounds (not []): .activity-badge__expand only
  // renders once those are ready (they come from an async fetch), so
  // expandRef.current is still null on the mount-time run this effect would
  // otherwise be stuck with — leaving the listener never attached at all,
  // and the popover's tilt permanently stale at whatever angle it had before
  // it ever expanded.
  useEffect(() => {
    const cardEl = cardRef.current
    const expandEl = expandRef.current
    if (!cardEl || !expandEl) return

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'grid-template-rows' || event.propertyName === 'width') {
        window.dispatchEvent(new Event('resize'))
      }
    }

    cardEl.addEventListener('transitionend', handleTransitionEnd)
    expandEl.addEventListener('transitionend', handleTransitionEnd)
    return () => {
      cardEl.removeEventListener('transitionend', handleTransitionEnd)
      expandEl.removeEventListener('transitionend', handleTransitionEnd)
    }
  }, [mapTracks, mapBounds])

  // Stay hidden until there's a route to draw, matching how the Last.fm badge
  // behaves when there's nothing playing.
  if (!track) return null

  return (
    <div
      className={`activity-badge activity-badge--floating${isExpanded ? ' is-expanded' : ''}`}
      ref={cardRef}
    >
      {/* maxAngle bumped well past TiltCard's default 12deg — at 12, the
          card's own rotation (as opposed to the busy map content inside it)
          was too subtle to register as "the card leaning" once expanded to
          its full size, even with the tilt correctly recalculating (see the
          resize-driven re-measure fix elsewhere in this file/TiltCard.tsx). */}
      <TiltCard glareEnable={false} scale={1} maxAngle={24}>
        <div className='activity-badge__shell'>
        <div className='activity-badge__row'>
          <svg
            className='activity-badge__map'
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            role='img'
            aria-label={`Map polygon`}
          >
            <path d={toSvgPath(track.points, SVG_SIZE, SVG_PADDING)} />
          </svg>

          <p className='activity-badge__title'>Recent vector</p>
        </div>

        {mapTracks.length > 1 && mapBounds && (
          <div className='activity-badge__expand' ref={expandRef}>
            <div className='activity-badge__expand-inner'>
              <p className='activity-badge__expand-heading'>Recent tracks</p>
              <svg
                className='activity-badge__combined-map'
                viewBox={`0 0 ${MAP_SVG_SIZE} ${MAP_SVG_SIZE}`}
                role='img'
                aria-label='Recent tracks, overlaid on one map'
              >
                <defs>
                  <pattern
                    id={gridPatternId}
                    width={GRID_SPACING}
                    height={GRID_SPACING}
                    patternUnits='userSpaceOnUse'
                  >
                    <circle className='activity-badge__grid-dot' cx={1} cy={1} r={0.6} />
                  </pattern>
                </defs>
                <rect
                  x={0}
                  y={0}
                  width={MAP_SVG_SIZE}
                  height={MAP_SVG_SIZE}
                  fill={`url(#${gridPatternId})`}
                />

                {contourLevels.map((level) => (
                  <path key={level.elevation} className='activity-badge__contour' d={level.d}>
                    <title>{`${level.elevation.toFixed(0)}m`}</title>
                  </path>
                ))}

                {mapTracks.map((item, index) => (
                  <g
                    key={item.id}
                    className={`activity-badge__track${item.id === track.id ? ' is-latest' : ''}`}
                  >
                    <title>{item.name}</title>
                    {/* Fatter, invisible: fill: none paths only register a
                        hover over their actual stroke, and the visible
                        line's 2px is too thin a target to hover reliably. */}
                    <path className='activity-badge__track-hit' d={combinedPaths[index]} />
                    <path className='activity-badge__track-line' d={combinedPaths[index]} />
                  </g>
                ))}

                {/* Corner labels are the raw coordinate extremes of the tracks
                    drawn above, not tick marks tied to the grid dots — the
                    grid is a plain backdrop, unrelated to degrees. */}
                <text className='activity-badge__axis-label' x={4} y={4} textAnchor='start' dominantBaseline='hanging'>
                  {mapBounds.maxLat.toFixed(3)}°N
                </text>
                <text
                  className='activity-badge__axis-label'
                  x={MAP_SVG_SIZE - 4}
                  y={4}
                  textAnchor='end'
                  dominantBaseline='hanging'
                >
                  {mapBounds.maxLng.toFixed(3)}°E
                </text>
                <text
                  className='activity-badge__axis-label'
                  x={4}
                  y={MAP_SVG_SIZE - 4}
                  textAnchor='start'
                  dominantBaseline='auto'
                >
                  {mapBounds.minLng.toFixed(3)}°E
                </text>
                <text
                  className='activity-badge__axis-label'
                  x={MAP_SVG_SIZE - 4}
                  y={MAP_SVG_SIZE - 4}
                  textAnchor='end'
                  dominantBaseline='auto'
                >
                  {mapBounds.minLat.toFixed(3)}°N
                </text>
              </svg>
            </div>
          </div>
        )}
        </div>
      </TiltCard>
    </div>
  )
}

export default ActivityWidget
