import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { computeBounds, largestCluster, latLngBounds, projectPath, projectPoint, toSvgPath, type LatLng } from './projectRoute'
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

type View = { x: number; y: number; width: number; height: number }

// public/activities.json and public/topo.json are written at build time by
// scripts/fetch-activities.mjs and scripts/fetch-elevation.mjs.
const DATA_URL = '/activities.json'
const TOPO_URL = '/topo.json'
const SVG_SIZE = 100
const SVG_PADDING = 6
// The full map gets more room than the tight crop, so close-together routes
// still read as separate lines rather than one blur.
const MAP_SVG_SIZE = 200
const MAP_SVG_PADDING = 10
// Coarse enough to read as a coordinate reference (like a paper map's
// graticule) rather than a texture. 40 divided the 200-unit map evenly,
// which put a grid line exactly on every edge of the canvas — bumped up so
// it doesn't, and the pattern's own x/y offset below (half a cell) shifts
// the near corner off the edge too, so no line touches the border anywhere.
const GRID_SPACING = 48
// How long the popover waits, after the cursor actually arrives or leaves,
// before it opens or closes — long enough that passing over or near the
// badge on the way elsewhere doesn't read as an open-close flicker. Closing
// waits longer: an accidental close (interrupting whatever the popover was
// showing) is more disruptive than an accidental open.
const EXPAND_DELAY_MS = 120
const COLLAPSE_DELAY_MS = 250
// How long the map's viewBox takes to animate between its tight (collapsed)
// and full (expanded) framing — matches the CSS transition on the stage's
// own width/height below, so the canvas growing and the view zooming out
// finish together.
const VIEW_ANIMATION_MS = 320
// The baseline map-unit HEIGHT the tight (collapsed) view sits at for any
// activity short enough to fit inside it — see the comment on tightView
// below. Picked so a typical few-kilometre loop reads at a consistent,
// legible size inside the collapsed rectangle rather than each activity
// rendering at its own, incidental scale. Width follows from
// COLLAPSED_ASPECT, not a separate number, so the baseline window is
// already shaped like the rectangle it's drawn into.
const TIGHT_VIEW_REFERENCE_HEIGHT = 24
// The collapsed rectangle's own on-screen aspect ratio (width ÷ height) —
// .activity-badge--floating's collapsed width (190px) ÷ .activity-badge__
// stage's collapsed height (64px) in Activity.css. tightView's viewBox is
// built at this same aspect ratio so it fills the rectangle edge to edge
// with no letterboxing, while still being sized (via Math.max against the
// track's own bounding box) to never crop the vector itself — see
// preserveAspectRatio="meet" on the svg below, which is what actually
// guarantees no cropping if this constant ever drifts out of sync with the
// CSS.
const COLLAPSED_ASPECT = 190 / 64

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

function ActivityWidget() {
  const [track, setTrack] = useState<Track | null>(null)
  // All tracks the build script pulled, newest first — expanding overlays
  // every one of them on the same map (the `bounds` below pools every
  // track's points into one bounding box, so a route in Keila and one in
  // Saue land at their true positions relative to each other, and nothing
  // outside that combined box — e.g. Tallinn — gets pulled in).
  const [tracks, setTracks] = useState<Track[]>([])
  const [topo, setTopo] = useState<Topo | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

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
  // Computed once and reused for the tracks, the contour lines, and both the
  // tight and full viewBox framings below, so everything this widget draws —
  // whichever framing is currently showing — lives in exactly one shared
  // coordinate system. There is only ever one canvas (see the single <svg>
  // in the render below): collapsed and expanded are just two different
  // viewBox rectangles animated between, not two separately-drawn maps.
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

  // The two framings the single canvas animates between. `fullView` is the
  // whole shared map (every track, matching `bounds`), square like `bounds`
  // itself. `tightView` is shaped like the collapsed rectangle
  // (COLLAPSED_ASPECT) and sized so the latest track's own bounding box
  // ALWAYS fits entirely inside it — never cropped — regardless of whether
  // the route itself is wide, tall, or square. Both are the same
  // `bounds`/projection, so panning or resizing between them never has to
  // reconcile two different coordinate systems.
  const fullView = useMemo<View>(() => ({ x: 0, y: 0, width: MAP_SVG_SIZE, height: MAP_SVG_SIZE }), [])
  const tightView = useMemo<View | null>(() => {
    if (!bounds || !track) return null

    const projected = track.points.map((point) => projectPoint(point, bounds, MAP_SVG_SIZE, MAP_SVG_PADDING))
    const minX = Math.min(...projected.map((point) => point.x))
    const maxX = Math.max(...projected.map((point) => point.x))
    const minY = Math.min(...projected.map((point) => point.y))
    const maxY = Math.max(...projected.map((point) => point.y))
    const trackWidth = maxX - minX
    const trackHeight = maxY - minY
    // A little breathing room around the track's own bounding box, rather
    // than cropping flush against it.
    const margin = Math.max(trackWidth, trackHeight) * 0.3 + 10
    const contentWidth = trackWidth + margin * 2
    const contentHeight = trackHeight + margin * 2
    // The smallest COLLAPSED_ASPECT-shaped window that still contains the
    // full content box in both dimensions — whichever dimension is the
    // tighter constraint (a tall route vs. the rectangle's own wide shape,
    // or vice versa) drives the size, then the other dimension follows the
    // fixed aspect ratio, so nothing needs the window to crop either axis.
    // Also floored at TIGHT_VIEW_REFERENCE_HEIGHT — a short activity
    // shouldn't get zoomed IN to fill the rectangle (it would read at a
    // different, inconsistent scale from every other short activity); it
    // sits at this same baseline zoom instead. Only a route whose own
    // extent already needs more room pushes the window out further.
    const height = Math.max(TIGHT_VIEW_REFERENCE_HEIGHT, contentHeight, contentWidth / COLLAPSED_ASPECT)
    const width = height * COLLAPSED_ASPECT

    return { x: (minX + maxX) / 2 - width / 2, y: (minY + maxY) / 2 - height / 2, width, height }
  }, [bounds, track])
  // Nothing to zoom out TO with only one track — stays on tightView, and the
  // hover/expand interaction becomes a no-op rather than "expanding" into an
  // identical view.
  const targetView = isExpanded || !tightView ? fullView : tightView

  // The viewBox actually rendered — animated toward `targetView` below
  // rather than snapping straight to it, so the canvas visibly zooms in/out
  // around the latest track instead of the two states just swapping.
  const [view, setView] = useState<View>(() => targetView)
  const viewAnimationRef = useRef<number | null>(null)

  useEffect(() => {
    if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current)

    const start = view
    const startTime = performance.now()

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / VIEW_ANIMATION_MS)
      const eased = easeOutCubic(t)

      setView({
        x: start.x + (targetView.x - start.x) * eased,
        y: start.y + (targetView.y - start.y) * eased,
        width: start.width + (targetView.width - start.width) * eased,
        height: start.height + (targetView.height - start.height) * eased,
      })

      viewAnimationRef.current = t < 1 ? requestAnimationFrame(step) : null
    }

    viewAnimationRef.current = requestAnimationFrame(step)

    return () => {
      if (viewAnimationRef.current !== null) cancelAnimationFrame(viewAnimationRef.current)
    }
    // Only the target's own values should restart the animation — including
    // `view` here would restart it on every single animated frame, since
    // `view` itself changes every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetView.x, targetView.y, targetView.width, targetView.height])

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
  // animate at once here (the stage's own height, and width on the outer
  // floating card), so both need to trigger a re-measure.
  useEffect(() => {
    const cardEl = cardRef.current
    const stageEl = stageRef.current
    if (!cardEl || !stageEl) return

    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'height' || event.propertyName === 'width') {
        window.dispatchEvent(new Event('resize'))
      }
    }

    cardEl.addEventListener('transitionend', handleTransitionEnd)
    stageEl.addEventListener('transitionend', handleTransitionEnd)
    return () => {
      cardEl.removeEventListener('transitionend', handleTransitionEnd)
      stageEl.removeEventListener('transitionend', handleTransitionEnd)
    }
  }, [])

  // Stay hidden until there's a route to draw, matching how the Last.fm badge
  // behaves when there's nothing playing.
  if (!track) return null

  return (
    <div
      className={`activity-badge activity-badge--floating${isExpanded ? ' is-expanded' : ''}`}
      ref={cardRef}
    >
      {/* maxAngle bumped past TiltCard's default 12deg — at 12, the card's
          own rotation (as opposed to the busy map content inside it) was too
          subtle to register as "the card leaning" once expanded to its full
          size, even with the tilt correctly recalculating (see the
          resize-driven re-measure fix elsewhere in this file/TiltCard.tsx).
          Pulled back down from an earlier 24, which read as too much lean. */}
      <TiltCard glareEnable={false} scale={1} maxAngle={16}>
        <div className='activity-badge__shell'>
          {/* One canvas, one coordinate system, for every state this widget
              is ever in — no separate collapsed icon and expanded map to
              keep in sync. `view` (animated toward tightView or fullView
              above) is the only thing that changes; the grid, the terrain,
              every track, and the corner labels are always all here,
              exactly once. */}
          <div className='activity-badge__stage' ref={stageRef}>
            <svg
              className='activity-badge__stage-map'
              viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
              preserveAspectRatio='xMidYMid meet'
              role='img'
              aria-label={isExpanded ? 'Recent tracks, overlaid on one map' : 'Map polygon'}
            >
              {bounds && (
                <>
                  <defs>
                    <pattern
                      id={gridPatternId}
                      x={GRID_SPACING / 2}
                      y={GRID_SPACING / 2}
                      width={GRID_SPACING}
                      height={GRID_SPACING}
                      patternUnits='userSpaceOnUse'
                    >
                      {/* Drawing just each tile's own top and left edges —
                          rather than a full rect border — still produces a
                          complete, continuous grid once the pattern
                          repeats, since adjacent tiles share those edges. */}
                      <path className='activity-badge__grid-line' d={`M0 0H${GRID_SPACING}M0 0V${GRID_SPACING}`} />
                    </pattern>
                  </defs>
                  {/* Faded in only once expanded — a coordinate graticule
                      reads as noise at the tight, zoomed-in crop, useful
                      context once zoomed out to the full map. */}
                  <rect
                    className={`activity-badge__grid${isExpanded ? ' is-visible' : ''}`}
                    x={0}
                    y={0}
                    width={MAP_SVG_SIZE}
                    height={MAP_SVG_SIZE}
                    fill={`url(#${gridPatternId})`}
                  />
                </>
              )}

              {contourLevels.map((level) => (
                <path key={level.elevation} className='activity-badge__contour' d={level.d}>
                  <title>{`${level.elevation.toFixed(0)}m`}</title>
                </path>
              ))}

              {bounds
                ? mapTracks.map((item, index) => (
                    <g
                      key={item.id}
                      className={`activity-badge__track${item.id === track.id ? ' is-latest' : ''}`}
                    >
                      <title>{item.name}</title>
                      {/* Fatter, invisible: fill: none paths only register
                          a hover over their actual stroke, and the visible
                          line's 2px is too thin a target to hover
                          reliably. */}
                      <path className='activity-badge__track-hit' d={combinedPaths[index]} />
                      <path className='activity-badge__track-line' d={combinedPaths[index]} />
                    </g>
                  ))
                : (
                    // Fallback for the rare single-activity case (no second
                    // track to cluster against, so no shared `bounds` at
                    // all): the track's own independent local projection.
                    <g className='activity-badge__track is-latest'>
                      <path className='activity-badge__track-line' d={toSvgPath(track.points, SVG_SIZE, SVG_PADDING)} />
                    </g>
                  )}

              {/* Corner labels are the raw coordinate extremes of the
                  tracks actually on the map, not tick marks tied to the
                  grid dots — the grid is a plain backdrop, unrelated to
                  degrees. Faded in only once expanded, same as the grid. */}
              {mapBounds && (
                <g className={`activity-badge__axis-labels${isExpanded ? ' is-visible' : ''}`}>
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
                </g>
              )}
            </svg>

            {/* Absolutely positioned, not a flex sibling of the map above —
                its place is fixed regardless of where the vector/topo
                happen to fall in their own coordinate system, rather than
                being pushed around by that content. */}
            <p className='activity-badge__title'>Recent vector</p>
          </div>
        </div>
      </TiltCard>
    </div>
  )
}

export default ActivityWidget
