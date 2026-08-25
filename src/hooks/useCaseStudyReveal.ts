import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

// Fades each case study's screenshots up as they come into view. The copy is
// left alone deliberately — it's readable the moment you arrive, and only the
// visuals animate in as you reach them.
//
// The page scrolls inside .app-scroll, not the window, so ScrollTrigger has to
// be told which element to watch.
// How long the page must sit still before it's safe to re-measure.
const SCROLL_IDLE_MS = 250

export function useCaseStudyReveal() {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.app-scroll')
    if (!scroller) return

    const context = gsap.context(() => {
      const media = gsap.matchMedia()

      media.add('(prefers-reduced-motion: no-preference)', () => {
        // Per-block triggers rather than one stagger per case study: a piece
        // can run several screens tall, so a single trigger would run images
        // still far off screen and they'd arrive already faded in.
        gsap.utils.toArray<HTMLElement>('.case-study__media-block').forEach((block) => {
          const items = block.querySelectorAll(':scope > .case-study__media-item')
          if (!items.length) return

          gsap.set(items, { y: 40, opacity: 0 })

          ScrollTrigger.create({
            trigger: block,
            scroller,
            start: 'top 85%',
            invalidateOnRefresh: true,
            onEnter: (self) => {
              // The screenshots are lazy-loaded, so until they land the page
              // is a fraction of its height and every block is bunched near
              // the top — inside the trigger zone. Those fires are spurious:
              // check the block is really on screen before spending the
              // reveal, or all but the first would play where nobody sees it.
              const blockBox = block.getBoundingClientRect()
              const viewBox = scroller.getBoundingClientRect()
              if (blockBox.top > viewBox.bottom || blockBox.bottom < viewBox.top) return

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

              // Played for real, so it doesn't need watching any more.
              self.kill()
            },
          })
        })
      })

      return () => media.revert()
    })

    // The screenshots are lazy-loaded, so at mount the page is a fraction of
    // its final height and every block sits near the top — ScrollTrigger reads
    // their start points as already passed. Re-measuring as the content grows
    // is what keeps the blocks further down honest.
    //
    // But refresh() forces a synchronous reflow and re-reads scroll position,
    // so doing it as each image lands makes a mobile scroll stutter — that's
    // exactly when images are loading. So: never refresh mid-scroll, and wait
    // for a lull afterwards. The reveal doesn't need precise measurements to
    // be correct — onEnter checks real visibility before playing — so a late
    // refresh costs nothing.
    let idleTimeout: number | null = null

    const runRefresh = () => {
      idleTimeout = null
      ScrollTrigger.refresh()
    }

    const refresh = () => {
      if (idleTimeout !== null) window.clearTimeout(idleTimeout)
      idleTimeout = window.setTimeout(runRefresh, SCROLL_IDLE_MS)
    }

    // Address bar show/hide on iOS and Android resizes the viewport constantly
    // while scrolling; without this GSAP treats each as a resize to react to.
    ScrollTrigger.config({ ignoreMobileResize: true })

    const content = document.querySelector<HTMLElement>('.app-content')
    const observer = content ? new ResizeObserver(refresh) : null
    observer?.observe(content!)

    // A cached image can be complete before this runs, and fires no event.
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.case-study-image'))
    images.forEach((image) => {
      if (image.complete) return

      image.addEventListener('load', refresh)
      image.addEventListener('error', refresh)
    })

    // Any scroll pushes a pending refresh back, so one never lands mid-gesture.
    scroller.addEventListener('scroll', refresh, { passive: true })

    refresh()
    window.addEventListener('load', refresh)

    return () => {
      if (idleTimeout !== null) window.clearTimeout(idleTimeout)
      observer?.disconnect()
      images.forEach((image) => {
        image.removeEventListener('load', refresh)
        image.removeEventListener('error', refresh)
      })
      scroller.removeEventListener('scroll', refresh)
      window.removeEventListener('load', refresh)
      context.revert()
    }
  }, [])
}
