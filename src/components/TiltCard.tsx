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
// A press starting on one of these skips the tilt-drag handling entirely
// (see handlePointerDown), so the browser's native text-selection drag gets
// the gesture uncontested instead of being read as a drag-to-tilt. Mirrors
// the cursor: text selector in App.css — same elements, same reasoning.
const SELECTABLE_TEXT_SELECTOR =
  '.music-widget__eyebrow, .music-widget__marquee-item, .music-widget__expand-heading, .music-widget__expand-artist, .activity-badge__title, .activity-badge__expand-heading'

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
  // True only once a press has actually moved past DRAG_SLOP — unlike
  // isDragging above (set the instant the pointer goes down, so the CSS
  // grabbing cursor shows right away), this drives suppressing text
  // selection, which needs to stay off until a real drag is confirmed. Set
  // it any earlier and it fires on every plain click too, since a click
  // starts as a pointerdown indistinguishable from the start of a drag —
  // which ate the ability to select any of the badges' text entirely.
  const [isDragConfirmed, setIsDragConfirmed] = useState(false)

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
    setIsDragConfirmed(false)

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

  // react-parallax-tilt only recomputes its rotation angle inside its own
  // mousemove handler — it has no way to notice the card growing underneath
  // a cursor that hasn't moved (the Last.fm/Activity badges' hover-expand
  // popover). Left alone, the rotation stays frozen at whatever it was
  // right before the card grew: a small angle computed against the old,
  // compact box's dimensions, applied to a box now several times taller —
  // technically still "tilted", but by an amount that no longer has
  // anything to do with where the cursor actually is relative to the
  // current card, and small enough on a large card to barely read as tilt
  // at all. Tracking the pointer's last position here and, on the same
  // `resize` event callers already dispatch to fix the glare (see the
  // glareEnable doc comment above), replaying it as a synthetic mousemove
  // forces the library to redo that calculation against the card's actual
  // current size.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const trackPointer = (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
    }

    // Without this, a resize firing after the pointer has already left (the
    // popover collapsing back down is itself what fires it, via the
    // transitionend listeners below) would replay a stale position from
    // when the pointer was still over the card — forcing a fresh, wrong
    // tilt angle back on right as the card is trying to settle flat.
    const clearPointer = () => {
      lastPointerRef.current = null
    }

    const replayPointer = () => {
      const point = lastPointerRef.current
      // react-parallax-tilt attaches its own mousemove handler directly to
      // its root node (.tilt-card, a child of this wrapper) — dispatching
      // on the wrapper itself would only bubble upward, past that handler
      // rather than through it, so this has to target .tilt-card directly.
      const tiltNode = wrapper.querySelector<HTMLElement>('.tilt-card')
      if (!point || !tiltNode) return

      tiltNode.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: point.x,
          clientY: point.y,
        }),
      )
    }

    wrapper.addEventListener('pointermove', trackPointer)
    wrapper.addEventListener('pointerleave', clearPointer)
    window.addEventListener('resize', replayPointer)

    return () => {
      wrapper.removeEventListener('pointermove', trackPointer)
      wrapper.removeEventListener('pointerleave', clearPointer)
      window.removeEventListener('resize', replayPointer)
    }
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Touch included: the CSS `touch-action: pan-y` on the wrapper leaves
    // vertical scrolling to the browser, so a finger dragged down the badge
    // scrolls the page as it would anywhere else, and only sideways movement
    // is ours to tilt with. If the browser does claim the gesture, it sends
    // pointercancel and the badge settles back on its own.
    if (prefersReducedMotion || event.button !== 0) return
    // Text over the tilt: starting a press here, this never sets up drag
    // tracking at all, so there's nothing for pointer capture to later
    // claim away from the browser's own text-selection drag.
    if ((event.target as HTMLElement).closest?.(SELECTABLE_TEXT_SELECTOR)) return

    clearSettle()
    originRef.current = { x: event.clientX, y: event.clientY }
    pointerIdRef.current = event.pointerId
    isDraggingRef.current = true
    setIsDragging(true)
    didDragRef.current = false
    setIsDragConfirmed(false)
    // Pointer capture itself waits for handlePointerMove below, once a real
    // drag is confirmed — capturing here unconditionally would claim every
    // plain click too, and a captured element is where the browser sends the
    // click event that follows, not wherever the cursor actually is. That
    // silently ate clicks on the Last.fm popover's footer link: pointerdown
    // captured the wrapper, so its own click (with no drag in between) fired
    // on the wrapper instead of the link underneath the cursor.
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
    if (!didDragRef.current) {
      const passedSlop = Math.abs(dx) > DRAG_SLOP || Math.abs(dy) > DRAG_SLOP
      if (!passedSlop) return

      // A vertical-dominant move is a scroll, not a tilt drag — touch-action:
      // pan-y on the wrapper is meant to leave that to the browser (see the
      // comment on handlePointerDown), but without this check every move
      // past the slop was treated as a drag regardless of direction, which
      // set dragAngles (visibly tilting the badge) and captured the pointer
      // before the browser ever got to recognize its own pan gesture —
      // hijacking a finger scrolling the page into a tilt instead. Bailing
      // out here, uncaptured, hands the gesture to native scrolling.
      if (Math.abs(dy) > Math.abs(dx)) {
        originRef.current = null
        isDraggingRef.current = false
        setIsDragging(false)
        setDragAngles(null)
        return
      }

      didDragRef.current = true
      // Claimed now, not on pointerdown — see the comment there. By this
      // point the gesture is confirmed to be a drag, so it's safe to start
      // tracking the pointer even once it leaves the badge's own bounds.
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDragConfirmed(true)
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
      className={`tilt-card-grab${isDragging ? ' is-dragging' : ''}${isDragConfirmed ? ' is-drag-confirmed' : ''}`}
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
        // Overrides the library's default cubic-bezier(.03,.98,.52,.99) —
        // that curve reaches ~98% of the way to its target within the first
        // few percent of its duration, which is fine for a one-off
        // enter/leave snap but reads as instant, snappy tracking when it's
        // retargeted on every mousemove during an ordinary hover (each new
        // retarget "finishes" almost immediately, so motion never actually
        // eases). This one ramps up and decelerates smoothly across the
        // whole duration instead, so continuous tracking reads as a smooth
        // follow rather than a snap. Kept in sync with the matching
        // cubic-bezier in .tilt-card (App.css) — see the comment there.
        transitionEasing='cubic-bezier(0.33, 1, 0.68, 1)'
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
