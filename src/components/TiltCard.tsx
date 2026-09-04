import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import Tilt from 'react-parallax-tilt'

type TiltCardProps = {
  className?: string
  children: ReactNode
  // The badges default to this. react-parallax-tilt maps cursor position as a
  // percentage of the element's own box to this angle, so the same angle
  // reads as a much bigger lean on a large box (e.g. the hero) than on a
  // small badge — its corners travel further for the same rotation. Callers
  // with a bigger box should pass a smaller angle to match how much the
  // badges actually lean.
  maxAngle?: number
  // The glare overlay is sized once, at mouseenter, and only ever re-measured
  // on a window resize — it has no way to notice a card that changes size for
  // its own reasons afterward (the Last.fm badge's hover-expand popover). The
  // size itself can be corrected (dispatching a resize event), but the
  // glare's rendered shape only repaints on the next mousemove-driven frame,
  // so there's a window where its raw, unmasked diamond is visible mid-resize
  // — a caller that resizes on hover should pass false rather than chase
  // that. Defaults true to match the two static badges' existing look.
  glareEnable?: boolean
  // The library scales the card up on hover, and snaps back to this any time
  // its own mouseenter/mouseleave re-fires — which, on a card tall enough
  // that a rotated far edge visibly drifts under a stationary cursor (the
  // Last.fm badge's footer link, near the bottom of the expanded popover),
  // can retrigger repeatedly and read as the whole card growing rather than
  // settling. Passing 1 removes the scale-up so that can't happen, without
  // needing to fix the underlying flicker itself.
  scale?: number
}

type Angles = {
  x: number
  y: number
}

// Shared hover tilt for the two floating badges, so they lean the same amount.
// Reduced-motion visitors get a plain, static card.
const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const DEFAULT_MAX_ANGLE = 12
// Pixels of drag that map to the full max-angle lean. Roughly a badge's own
// width, so the lean keeps up with the hand rather than needing a haul across
// the page.
const DRAG_RANGE = 90
// Movement under this reads as a click, not a drag, so the link still opens.
const DRAG_SLOP = 4
// Matches the CSS ease on .tilt-card, so control returns to the hover tilt
// only once the badge has finished settling flat.
const SETTLE_MS = 900

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function TiltCard({ className, children, maxAngle = DEFAULT_MAX_ANGLE, glareEnable = true, scale = 1.04 }: TiltCardProps) {
  // Dragging leans no further than hovering does — what it adds is reach: the
  // pointer keeps steering the badge after it leaves the badge's own bounds.
  const dragMaxAngle = maxAngle
  // Non-null while dragging or settling: the library hands control to the
  // manual angles, so the pointer keeps steering the badge after it leaves
  // the badge's own bounds.
  const [dragAngles, setDragAngles] = useState<Angles | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const originRef = useRef<Angles | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const didDragRef = useRef(false)
  const settleTimeoutRef = useRef<number | null>(null)
  // Ref for the event logic (always current), state for the class name
  // (drives the re-render that applies it).
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)

  const clearSettle = useCallback(() => {
    if (settleTimeoutRef.current === null) return

    window.clearTimeout(settleTimeoutRef.current)
    settleTimeoutRef.current = null
  }, [])

  // Works off refs rather than the event target, so the window-level safety
  // nets below can end a drag the element never heard about.
  const finishDrag = useCallback((point: Angles | null) => {
    if (!originRef.current) return

    originRef.current = null
    isDraggingRef.current = false
    setIsDragging(false)

    const wrapper = wrapperRef.current
    const pointerId = pointerIdRef.current
    pointerIdRef.current = null

    if (wrapper && pointerId !== null && wrapper.hasPointerCapture(pointerId)) {
      wrapper.releasePointerCapture(pointerId)
    }

    const bounds = wrapper?.getBoundingClientRect()
    const releasedOverBadge =
      !!bounds &&
      !!point &&
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom

    // Released back over the badge: real mousemove events resume, so handing
    // straight back to the hover tilt picks up from where the drag left off.
    if (releasedOverBadge) {
      clearSettle()
      setDragAngles(null)
      return
    }

    // Released away from the badge, where no mousemove will ever arrive to
    // correct it. Steer it flat ourselves — still on the manual angles, so
    // the CSS ease carries it — and only then hand back to hover. Dropping
    // to null first would strand it at the dragged angle, since the library
    // mirrors the manual angles into the pointer position it falls back on.
    setDragAngles({ x: 0, y: 0 })
    clearSettle()
    settleTimeoutRef.current = window.setTimeout(() => {
      setDragAngles(null)
      settleTimeoutRef.current = null
    }, SETTLE_MS)
  }, [clearSettle])

  // Safety net: a drag can end without the element ever seeing pointerup —
  // right-click, alt-tab, a release outside the window, the tab going
  // background. Each of those used to strand the badge mid-tilt.
  useEffect(() => {
    if (!dragAngles) return

    const endFromEvent = (event: PointerEvent) => finishDrag({ x: event.clientX, y: event.clientY })
    const endBlind = () => finishDrag(null)

    window.addEventListener('pointerup', endFromEvent)
    window.addEventListener('pointercancel', endFromEvent)
    window.addEventListener('lostpointercapture', endBlind)
    window.addEventListener('blur', endBlind)
    window.addEventListener('contextmenu', endBlind)

    return () => {
      window.removeEventListener('pointerup', endFromEvent)
      window.removeEventListener('pointercancel', endFromEvent)
      window.removeEventListener('lostpointercapture', endBlind)
      window.removeEventListener('blur', endBlind)
      window.removeEventListener('contextmenu', endBlind)
    }
  }, [dragAngles, finishDrag])

  useEffect(() => clearSettle, [clearSettle])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch included: the CSS `touch-action: pan-y` on the wrapper leaves
    // vertical scrolling to the browser, so a finger dragged down the badge
    // scrolls the page as it would anywhere else, and only sideways movement
    // is ours to tilt with. If the browser does claim the gesture, it sends
    // pointercancel and the badge settles back on its own.
    if (prefersReducedMotion || event.button !== 0) return

    clearSettle()
    originRef.current = { x: event.clientX, y: event.clientY }
    pointerIdRef.current = event.pointerId
    isDraggingRef.current = true
    setIsDragging(true)
    didDragRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragAngles({ x: 0, y: 0 })
  }, [clearSettle])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = originRef.current
    if (!origin) {
      // Moving over the badge while it settles: hover can take it from here,
      // rather than holding it flat for the rest of the timeout.
      if (settleTimeoutRef.current !== null) {
        clearSettle()
        setDragAngles(null)
      }
      return
    }

    const dx = event.clientX - origin.x
    const dy = event.clientY - origin.y
    if (Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP) {
      didDragRef.current = true
    }

    const scale = dragMaxAngle / DRAG_RANGE

    setDragAngles({
      // Drag down and the top edge leans away, matching how the hover tilt reads.
      x: clamp(-dy * scale, dragMaxAngle),
      y: clamp(dx * scale, dragMaxAngle),
    })
  }, [clearSettle, dragMaxAngle])

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    finishDrag({ x: event.clientX, y: event.clientY })
  }, [finishDrag])

  return (
    <div
      ref={wrapperRef}
      className={`tilt-card-grab${isDragging ? ' is-dragging' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        // A drag that ended on the Last.fm badge shouldn't also open Last.fm.
        if (!didDragRef.current) return

        event.preventDefault()
        event.stopPropagation()
        didDragRef.current = false
      }}
    >
      <Tilt
        className={['tilt-card', className].filter(Boolean).join(' ')}
        tiltEnable={!prefersReducedMotion}
        tiltMaxAngleX={maxAngle}
        tiltMaxAngleY={maxAngle}
        tiltAngleXManual={dragAngles?.x ?? null}
        tiltAngleYManual={dragAngles?.y ?? null}
        scale={scale}
        perspective={700}
        transitionSpeed={900}
        glareEnable={glareEnable && !prefersReducedMotion}
        glareMaxOpacity={0.18}
        glareBorderRadius='12px'
      >
        {children}
      </Tilt>
    </div>
  )
}

export default TiltCard
