import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import Tilt from 'react-parallax-tilt'

type TiltCardProps = {
  className?: string
  children: ReactNode
}

type Angles = {
  x: number
  y: number
}

// Shared hover tilt for the two floating badges, so they lean the same amount.
// Reduced-motion visitors get a plain, static card.
const prefersReducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const HOVER_MAX_ANGLE = 12
// Dragging leans no further than hovering does — what it adds is reach: the
// pointer keeps steering the badge after it leaves the badge's own bounds.
const DRAG_MAX_ANGLE = HOVER_MAX_ANGLE
// Pixels of drag that map to the full DRAG_MAX_ANGLE lean. Roughly a badge's
// own width, so the lean keeps up with the hand rather than needing a haul
// across the page.
const DRAG_RANGE = 90
// Movement under this reads as a click, not a drag, so the link still opens.
const DRAG_SLOP = 4
// Matches the CSS ease on .tilt-card, so control returns to the hover tilt
// only once the badge has finished settling flat.
const SETTLE_MS = 900

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function TiltCard({ className, children }: TiltCardProps) {
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

    const scale = DRAG_MAX_ANGLE / DRAG_RANGE

    setDragAngles({
      // Drag down and the top edge leans away, matching how the hover tilt reads.
      x: clamp(-dy * scale, DRAG_MAX_ANGLE),
      y: clamp(dx * scale, DRAG_MAX_ANGLE),
    })
  }, [clearSettle])

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
        tiltMaxAngleX={HOVER_MAX_ANGLE}
        tiltMaxAngleY={HOVER_MAX_ANGLE}
        tiltAngleXManual={dragAngles?.x ?? null}
        tiltAngleYManual={dragAngles?.y ?? null}
        scale={1.04}
        perspective={700}
        transitionSpeed={900}
        glareEnable={!prefersReducedMotion}
        glareMaxOpacity={0.18}
        glareBorderRadius='12px'
      >
        {children}
      </Tilt>
    </div>
  )
}

export default TiltCard
