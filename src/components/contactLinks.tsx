// The one list of "where else to find me" links. Rendered twice: pinned to the
// top-right of the frame, and again in the footer at the bottom of every page.
export const contactLinks = [
  { label: 'Email', href: 'mailto:karlsimmer@gmail.com' },
  { label: 'GitHub', href: 'https://github.com/systmatic0' },
  { label: 'Figma', href: 'https://www.figma.com/@kungfury' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/karlsimmer/' },
  { label: 'CV', href: '/cv.pdf' },
]

type ContactLinkListProps = {
  className: string
  ariaLabel: string
}

export function ContactLinkList({ className, ariaLabel }: ContactLinkListProps) {
  return (
    <nav className={className} aria-label={ariaLabel}>
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
  )
}
