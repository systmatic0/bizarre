import { useLayoutEffect } from 'react'
import gsap from 'gsap'

// Fades each case study's screenshots up as they come into view. The copy is
// left alone deliberately — it's readable the moment you arrive, and only the
// visuals animate in as you reach them.
//
// Visibility is decided by IntersectionObserver rather than GSAP's
// ScrollTrigger. The screenshots are lazy-loaded, so the page grows constantly
// as you scroll it; ScrollTrigger measures start positions up front and has to
// re-measure on every change, which means either a reflow mid-scroll (a
// stutter, right when images are landing) or stale positions that reveal the
// images long after you've scrolled past them. IntersectionObserver just
// reports what's actually on screen, measuring nothing.
//
// The blocks are hidden in a layout effect — before the browser paints — so a
// block never shows at full opacity and then snap to transparent as the
// observer catches up. Hiding and observing happen in the same synchronous
// pass, so there's no window where they could be left hidden with nothing
// watching to reveal them.

export function useCaseStudyReveal() {
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.app-scroll')
    if (!scroller) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const context = gsap.context(() => {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return

            const block = entry.target
            observer.unobserve(block)

            const items = block.querySelectorAll(':scope > .case-study__media-item')
            if (!items.length) return

            gsap.to(items, {
              y: 0,
              opacity: 1,
              duration: 0.7,
              // Only reads as a stagger in the three-up grids; a stacked
              // block holds one image, where it's a no-op.
              stagger: 0.12,
              ease: 'power2.out',
              clearProps: 'transform,opacity',
            })
          })
        },
        { root: scroller, threshold: 0 },
      )

      document.querySelectorAll<HTMLElement>('.case-study__media-block').forEach((block) => {
        const items = block.querySelectorAll(':scope > .case-study__media-item')
        if (!items.length) return

        gsap.set(items, { y: 40, opacity: 0 })
        observer.observe(block)
      })

      return () => observer.disconnect()
    })

    return () => context.revert()
  }, [])
}
