import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import Background from './Background'
import Logo from './Logo'
import Navbar from './Navbar'
import SiteFooter from './SiteFooter'
import { scrambleElementOnce } from './scrambleText'
import { scrollAppToTop } from './scrollToTop'
import { Link } from 'react-router-dom'

type PageLayoutProps = {
  children: ReactNode
}

// The scramble glitch belongs to headings, not links — the home intro's own
// "Hello there explorer." and every portfolio item's title. It runs once,
// the moment a heading actually appears, not on hover: a link underneath the
// cursor gets a plain colour flash instead (see .music-widget__expand-footer
// :hover in App.css, which this now matches).
const HEADING_GLITCH_SELECTOR = '.home-intro h1, .case-study__title'

// Distance (px, from the cursor to a .container card's nearest edge) at
// which the border glow's intensity bottoms out — see the pointermove
// handler below. Beyond this every card just sits at GLOW_MIN_ALPHA.
const GLOW_FALLOFF_PX = 640
// Bright-stop opacity at zero distance (cursor on/over the card) and at
// GLOW_FALLOFF_PX or beyond, respectively.
const GLOW_MAX_ALPHA = 0.85
const GLOW_MIN_ALPHA = 0.12

function PageLayout({ children }: PageLayoutProps) {
  const location = useLocation()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const contentClassName = location.pathname === '/'
    ? 'app-content app-content--home'
    : 'app-content'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0 })
  }, [location.pathname])

  useEffect(() => {
    const baseTitle = 'Karl Simmer'
    const contentElement = contentRef.current

    if (!contentElement) {
      document.title = baseTitle
      return
    }

    const updateTitle = () => {
      if (location.pathname === '/') {
        document.title = baseTitle
        return
      }

      const pageHeading = contentElement.querySelector('h1')?.textContent?.trim()
      document.title = pageHeading ? `${baseTitle} - ${pageHeading}` : baseTitle
    }

    const frame = window.requestAnimationFrame(updateTitle)
    const observer = new MutationObserver(updateTitle)

    observer.observe(contentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [location.pathname])

  // Keep the secret /tunes link out of search results even if it ever
  // gets linked to from somewhere outside this site.
  useEffect(() => {
    if (location.pathname !== '/tunes') return

    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)

    return () => {
      meta.remove()
    }
  }, [location.pathname])

  // Drives the cursor-following border glow on every .container card
  // (App.css), all at once and continuously — not just whichever one the
  // cursor happens to be over. Each card gets its own --glow-x/--glow-y
  // (the cursor's position relative to that card's own box, as a
  // percentage — read by the border's radial-gradient background as the
  // light's centre) and --glow-alpha (how bright that light is, falling off
  // with the cursor's distance from the card's nearest edge). Nothing here
  // switches on or off: every card is always being recomputed from the
  // cursor's actual position, so a card the cursor is far from just sits at
  // GLOW_MIN_ALPHA rather than needing to be told to "reset". Direct DOM
  // writes rather than React state — this fires on every pointermove, and
  // re-rendering for that would be needless churn when nothing here needs
  // React's own reconciliation. Window-level rather than delegated to the
  // scroll container: distance is computed from each card's own
  // getBoundingClientRect, not from event.target, so this doesn't need the
  // cursor to be over anything in particular — cards react to the cursor
  // passing over the navbar or any other chrome just the same.
  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const cards = document.querySelectorAll<HTMLElement>('.container')

      for (const card of cards) {
        card.classList.remove('container--gradient-resetting')

        const rect = card.getBoundingClientRect()
        // Left outside the card's own box, this lands the glow's centre
        // outside the 0-100% range — still a valid gradient position, and
        // exactly what "the light is off to that side" should look like.
        const xPercent = ((event.clientX - rect.left) / rect.width) * 100
        const yPercent = ((event.clientY - rect.top) / rect.height) * 100

        // Distance to the rect's own nearest point — 0 in the ordinary case
        // where the cursor is over the card, growing only once it's
        // actually outside it, from whichever edge or corner is closest.
        const nearestX = Math.min(Math.max(event.clientX, rect.left), rect.right)
        const nearestY = Math.min(Math.max(event.clientY, rect.top), rect.bottom)
        const distance = Math.hypot(event.clientX - nearestX, event.clientY - nearestY)
        // Squared, not linear, so the last stretch of the approach reads as
        // a distinct brightening rather than the glow being mostly "on"
        // for the whole falloff range.
        const proximity = Math.max(0, 1 - distance / GLOW_FALLOFF_PX) ** 2
        const alpha = GLOW_MIN_ALPHA + (GLOW_MAX_ALPHA - GLOW_MIN_ALPHA) * proximity

        card.style.setProperty('--glow-x', `${xPercent}%`)
        card.style.setProperty('--glow-y', `${yPercent}%`)
        card.style.setProperty('--glow-alpha', String(alpha))
      }
    }

    // Safety net for the cursor leaving the browser viewport entirely (off
    // the window edge) — no further pointermove ever arrives to keep fading
    // cards out as distance grows, so this eases every card back to its
    // resting brightness directly. relatedTarget is null exactly when the
    // pointer left the document rather than moving onto another element
    // within it.
    const handlePointerOut = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return

      const cards = document.querySelectorAll<HTMLElement>('.container')
      for (const card of cards) {
        card.classList.add('container--gradient-resetting')
        card.style.setProperty('--glow-alpha', String(GLOW_MIN_ALPHA))
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerout', handlePointerOut)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerout', handlePointerOut)
    }
  }, [])

  // Glitch every heading once it actually appears — the home intro's h1 on
  // load, each portfolio item's title as it scrolls into view. Re-runs per
  // route since the content below is remounted (fresh set of headings) then.
  useEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const animated = new WeakSet<Element>()
    let observer: IntersectionObserver | null = null

    const frame = window.requestAnimationFrame(() => {
      const headings = contentElement.querySelectorAll(HEADING_GLITCH_SELECTOR)
      if (!headings.length) return

      observer = new IntersectionObserver(
        (entries, currentObserver) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting || animated.has(entry.target)) return

            animated.add(entry.target)
            currentObserver.unobserve(entry.target)
            scrambleElementOnce(entry.target as HTMLElement)
          })
        },
        { threshold: 0.5 },
      )

      headings.forEach((heading) => observer?.observe(heading))
    })

    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [location.pathname])

  return (
    <div>
      <div className='app-frame'>
        <Background />
        <div className='logo-frame'>
          <Link
            to='/'
            aria-label='Home'
            onClick={(event) => {
              // Already home: the router would no-op, so scroll back up here.
              if (location.pathname !== '/') return

              event.preventDefault()
              scrollAppToTop()
            }}
          >
            <Logo className='logo-icon' />
          </Link>
        </div>
        <div ref={scrollRef} className='app-scroll'>
          <div ref={contentRef} className={contentClassName}>
            {children}
            <SiteFooter />
          </div>
        </div>
        <Navbar />
      </div>
    </div>

  )
}

export default PageLayout
