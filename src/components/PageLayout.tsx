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

// The scramble glitch belongs to prose links only: the home intro copy and a
// case study's description. Not buttons, not the icon buttons, and not the
// Last.fm widget — its shell is an anchor too, and scrambling it would garble
// the now-playing text; its footer link sits inside the popover's
// grid-template-rows: 1fr auto-height (see App.css), so scrambling its label
// into wider/narrower characters would grow or shrink the popover itself.
const GLITCH_SELECTOR =
  '.home-intro a:not(.music-widget__shell):not(.button-link):not(.icon-link):not(.music-widget__expand-footer), .case-study__description a'

// Meta-table links (e.g. a case study's external site link) get the hover
// glitch too, but never the scroll-into-view one below — they're off-screen
// in the fixed side panel on desktop, so "appears in viewport" doesn't apply
// the way it does for prose links scrolling through the main column.
const HOVER_GLITCH_SELECTOR = `${GLITCH_SELECTOR}, .case-study__detail-value a`

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

  // Glitch a case study description or meta-table link's own label on
  // hover/focus — delegated to the scroll container so it keeps working as
  // routes swap content.
  useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const active = new Set<HTMLElement>()

    const handleHover = (event: Event) => {
      const target = (event.target as HTMLElement).closest?.(HOVER_GLITCH_SELECTOR) as HTMLElement | null
      if (!target || active.has(target)) return

      active.add(target)
      const started = scrambleElementOnce(target as HTMLElement, () => active.delete(target))
      if (started === null) active.delete(target)
    }

    container.addEventListener('mouseover', handleHover)
    container.addEventListener('focusin', handleHover)

    return () => {
      container.removeEventListener('mouseover', handleHover)
      container.removeEventListener('focusin', handleHover)
    }
  }, [])

  // Glitch every case study description link once it scrolls into view —
  // re-runs per route since the content below is remounted (fresh set) then.
  useEffect(() => {
    const contentElement = contentRef.current
    if (!contentElement) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const animated = new WeakSet<Element>()
    let observer: IntersectionObserver | null = null

    const frame = window.requestAnimationFrame(() => {
      const anchors = contentElement.querySelectorAll(GLITCH_SELECTOR)
      if (!anchors.length) return

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

      anchors.forEach((anchor) => observer?.observe(anchor))
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
