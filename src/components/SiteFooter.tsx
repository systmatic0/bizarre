const contactLinks = [
  { label: 'Email', href: 'mailto:karlsimmer@gmail.com' },
  { label: 'GitHub', href: 'https://github.com/systmatic0' },
  { label: 'Figma', href: 'https://www.figma.com/@kungfury' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/karlsimmer/' },
  { label: 'CV', href: '/cv.pdf' },
]

function SiteFooter() {
  return (
    <footer className='site-footer'>
      <nav className='site-footer__links' aria-label='Contact'>
        {contactLinks.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            {...(href.startsWith('mailto:')
              ? {}
              : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            {label}
          </a>
        ))}
      </nav>
    </footer>
  )
}

export default SiteFooter
