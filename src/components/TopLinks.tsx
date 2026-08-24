import { ContactLinkList } from './contactLinks'

// Same links as the footer, pinned to the top-right of the frame so they're
// reachable without scrolling to the bottom of a long page.
function TopLinks() {
  return <ContactLinkList className='top-links' ariaLabel='Elsewhere' />
}

export default TopLinks
