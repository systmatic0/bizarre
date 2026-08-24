import { ContactLinkList } from './contactLinks'

function SiteFooter() {
  return (
    <footer className='site-footer'>
      <ContactLinkList className='site-footer__links' ariaLabel='Contact' />
    </footer>
  )
}

export default SiteFooter
