// The page scrolls inside .app-scroll, not the window, so "back to the top"
// has to target that container. Used when a nav link points at the route
// you're already on: the router won't remount anything, so the scroll reset
// PageLayout runs on a pathname change never fires.
export function scrollAppToTop() {
  const container = document.querySelector<HTMLElement>('.app-scroll')
  if (!container) return

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  container.scrollTo({
    top: 0,
    left: 0,
    behavior: prefersReducedMotion ? 'auto' : 'smooth',
  })
}
