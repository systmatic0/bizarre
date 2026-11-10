export const SCRAMBLE_CHARS = '********#%+=-·'
export const DURATION_MS = 300
export const STEPS = 10

export function scrambleFrom(text: string, revealedCount: number) {
  return text
    .split('')
    .map((char, index) => {
      if (index < revealedCount || char === ' ') return char
      return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
    })
    .join('')
}

export function collectTextNodes(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; original: string }[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (current.textContent && current.textContent.trim().length > 0) {
      nodes.push({ node: current as Text, original: current.textContent })
    }
  }
  return nodes
}

// Runs the scramble→reveal loop over the given text nodes, restoring the
// original text when done. Returns the interval id so callers can cancel it.
export function runScramble(nodes: { node: Text; original: string }[], onComplete?: () => void) {
  let step = 0

  const interval = window.setInterval(() => {
    step += 1

    nodes.forEach(({ node, original }) => {
      const revealed = Math.ceil((step / STEPS) * original.length)
      node.textContent = scrambleFrom(original, revealed)
    })

    if (step >= STEPS) {
      window.clearInterval(interval)
      nodes.forEach(({ node, original }) => {
        node.textContent = original
      })
      onComplete?.()
    }
  }, DURATION_MS / STEPS)

  return interval
}

// Runs the scramble on an element's own text nodes. For elements laid out
// as normal inline flow (e.g. a link inside a paragraph), height comes
// purely from line-height/font metrics — it can't shift from character
// substitution alone, so all that's needed is stopping the substituted
// text from wrapping onto a second line. Switching such an element to
// inline-block to lock its box (an earlier attempt at this) backfires: it
// changes how the browser computes the box's vertical position within the
// line, visibly nudging it. Block/flex-level elements don't have that
// problem, but do need their box locked so a wider scramble doesn't push
// a wrapped line (and everything after it) taller.
export function scrambleElementOnce(element: HTMLElement, onComplete?: () => void) {
  const nodes = collectTextNodes(element)
  if (!nodes.length) return null

  const computed = window.getComputedStyle(element)

  if (computed.display === 'inline') {
    const previousWhiteSpace = element.style.whiteSpace

    element.style.whiteSpace = 'nowrap'

    return runScramble(nodes, () => {
      element.style.whiteSpace = previousWhiteSpace
      onComplete?.()
    })
  }

  const rect = element.getBoundingClientRect()
  const previousWidth = element.style.width
  const previousHeight = element.style.height
  const previousOverflow = element.style.overflow
  const previousBoxSizing = element.style.boxSizing

  // getBoundingClientRect() always measures the full border box, but these
  // elements default to box-sizing: content-box — so setting `height` to
  // that same number would add the border back on top and grow the box.
  // Force border-box while locked so the numbers line up.
  element.style.boxSizing = 'border-box'
  element.style.width = `${rect.width}px`
  element.style.height = `${rect.height}px`
  element.style.overflow = 'hidden'

  return runScramble(nodes, () => {
    element.style.width = previousWidth
    element.style.height = previousHeight
    element.style.overflow = previousOverflow
    element.style.boxSizing = previousBoxSizing
    onComplete?.()
  })
}
