import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
// Dragging is allowed to push well past the hover clamp — that's the point of
// grabbing it — but not so far the badge turns edge-on and disappears.
const DRAG_MAX_ANGLE = 30
// Pixels of drag that map to the full DRAG_MAX_ANGLE lean.
const DRAG_RANGE = 220

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

function TiltCard({ className, children }: TiltCardProps) {
  // Non-null while dragging: the library hands control to the manual angles,
  // so the pointer keeps steering the badge after it leaves its own bounds.
  const [dragAngles, setDragAngles] = useState<Angles | null>(null)
  const originRef = useRef<Angles | null>(null)

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || event.button !== 0) return

    originRef.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragAngles({ x: 0, y: 0 })
  }, [])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = originRef.current
    if (!origin) return

    const scale = DRAG_MAX_ANGLE / DRAG_RANGE

    setDragAngles({
      // Drag down and the top edge leans away, matching how the hover tilt reads.
      x: clamp(-(event.clientY - origin.y) * scale, DRAG_MAX_ANGLE),
      y: clamp((event.clientX - origin.x) * scale, DRAG_MAX_ANGLE),
    })
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!originRef.current) return

    originRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    // Back to null hands the badge to the hover tilt, which springs it flat.
    setDragAngles(null)
  }, [])

  return (
    <div
      className='tilt-card-grab'
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
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
