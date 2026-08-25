import { useEffect, useRef } from 'react'
import { useRive } from '@rive-app/react-webgl2'
import hologramRiv from '../assets/hologram.riv?url'
import { Link } from 'react-router-dom'
import CaseStudy from '../components/CaseStudy'
import LastfmWidget from '../components/LastfmWidget'
import ActivityWidget from '../components/ActivityWidget'
import { Figma, Github } from 'lucide-react'
import { contactLinks } from '../components/contactLinks'
import { useCaseStudyReveal } from '../hooks/useCaseStudyReveal'

// GitHub and Figma as bare icons alongside the intro's buttons — recognisable
// enough not to need a label. Pulled from the same list the footer uses so the
// hrefs stay single-sourced.
const findLink = (label: string) => contactLinks.find((link) => link.label === label)!

const iconLinks = [
  { ...findLink('GitHub'), Icon: Github },
  { ...findLink('Figma'), Icon: Figma },
]


function Home() {
  const caseStudiesRef = useRef<HTMLElement | null>(null)

  useCaseStudyReveal()
  const heroWrapRef = useRef<HTMLDivElement | null>(null)
  const { RiveComponent, canvas } = useRive({
    src: hologramRiv,
    stateMachines: 'Play',
    autoplay: true,
  })

  // The Last.fm badge overlaps the avatar's corner, so moving onto it fires a
  // real `mouseout` on the canvas underneath, which Rive treats as the cursor
  // leaving and resets the hologram. We keep it reacting through that
  // transition by: swallowing that specific mouseout (only when it's headed
  // onto the badge, not truly leaving), and forwarding mousemove coordinates
  // to the canvas while hovering the badge so the motion keeps tracking. A
  // real exit — leaving the wrapper entirely — still resets normally.
  useEffect(() => {
    const wrap = heroWrapRef.current
    if (!wrap || !canvas) return

    const swallowInternalOut = (event: MouseEvent) => {
      if (event.target !== canvas) return
      const related = event.relatedTarget as Node | null
      if (related && wrap.contains(related)) {
        event.stopPropagation()
      }
    }

    const forwardMove = (event: MouseEvent) => {
      if (event.target === canvas) return
      canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: event.clientX,
        clientY: event.clientY,
        bubbles: true,
      }))
    }

    // True exit: if the cursor was last over the badge (not the canvas) when
    // it leaves the wrapper, canvas never gets a native mouseout at all — so
    // we fire one ourselves, with a relatedTarget outside the wrapper so our
    // own swallow logic above lets it through to Rive's real reset.
    const forwardExit = (event: MouseEvent) => {
      canvas.dispatchEvent(new MouseEvent('mouseout', {
        clientX: event.clientX,
        clientY: event.clientY,
        relatedTarget: document.body,
        bubbles: true,
      }))
    }

    wrap.addEventListener('mouseout', swallowInternalOut, true)
    wrap.addEventListener('mousemove', forwardMove)
    wrap.addEventListener('mouseleave', forwardExit)

    return () => {
      wrap.removeEventListener('mouseout', swallowInternalOut, true)
      wrap.removeEventListener('mousemove', forwardMove)
      wrap.removeEventListener('mouseleave', forwardExit)
    }
  }, [canvas])

  return (
    <div className='home-page'>
      <div className='home-intro'>
        <div ref={heroWrapRef} className='hero-rive-wrap'>
          <div className='container hero-rive'>
            <RiveComponent className='hero-rive-inner' />
          </div>

          <LastfmWidget />
          <ActivityWidget />
        </div>

        <div className='page-stack'>
          <div className='page-stack--tight'>
            <h1>Hello there explorer.</h1>
            <p>My name is Karl, I do product design and web development. On my journey, I've led design process for user-centric products and design systems.</p>
            <p>
              (Been designing for two <a href='https://www.lift99.co/walloffame' target='_blank' rel='noopener noreferrer'>#EstonianMafia</a> startups.)
            </p>
          </div>

          <div className='button-row'>
            <button
              type='button'
              className='button-link'
              onClick={() => {
                const scrollContainer = document.querySelector<HTMLElement>('.app-scroll')
                const caseStudiesSection = caseStudiesRef.current

                if (!scrollContainer || !caseStudiesSection) {
                  return
                }

                const scrollOffset = window.matchMedia('(max-width: 640px)').matches
                  ? 88
                  : 24

                const offsetTop =
                  scrollContainer.scrollTop +
                  caseStudiesSection.getBoundingClientRect().top -
                  scrollContainer.getBoundingClientRect().top -
                  scrollOffset

                scrollContainer.scrollTo({
                  top: offsetTop,
                  behavior: 'smooth',
                })
              }}
            >
              Check out my work
            </button>
            <a href='/cv.pdf' target='_blank' rel='noopener noreferrer' className='button-link'>Read my CV</a>

            {/* Grouped so the pair always wraps as one — otherwise a narrow
                row fits one icon beside the CV button and strands the other. */}
            <div className='button-row__icons'>
              {iconLinks.map(({ label, href, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target='_blank'
                  rel='noopener noreferrer'
                  aria-label={label}
                  className='icon-link'
                >
                  {/* 24px and 1.75 stroke to match the floating nav's icons. */}
                  <Icon size={24} strokeWidth={1.75} aria-hidden='true' />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section ref={caseStudiesRef} className='case-studies text-left'>
        <div className='case-studies__list'>
          <CaseStudy
            title='Moon Design System'
            description={[
              <>Moon Design System is an open-source, multi-framework design system used across Figma, CSS, React, and LiveView.</>,
              <>I led the Figma-facing design system and built a central component and template library used by multiple products. My work included:</>,
              <>
                <ul>
                  <li>Built an open-source design system with Figma, React, CSS, and LiveView.</li>
                  <li>Created a React documentation site with live components and token previews.</li>
                  <li>Drove adoption and workflow improvements across teams.</li>
                </ul>
              </>,
              <><Link to='/docs/moon'>Read case study</Link></>
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Lead Product Designer',
              },
              {
                label: 'Year',
                value: '2024-2025',
              },
              {
                label: 'Website',
                value: 'moondesignsystem.com',
                href: 'https://moondesignsystem.com/',
              },
            ]}
            media={[
              {
                layout: 'stack',
                images: [
                  {
                    src: '/moon/tokens.jpg',
                    alt: 'Tokens',
                  },
                ],
              },
              {
                layout: 'grid-3',
                images: [
                  {
                    src: '/moon/buttonproperties.jpg',
                    alt: 'Button properties',
                  },
                  {
                    src: '/moon/tagproperties.jpg',
                    alt: 'Tag properties',
                  },
                  {
                    src: '/moon/avatarproperties.jpg',
                    alt: 'Avatar properties',
                  },
                ],
              },
              {
                layout: 'stack',
                images: [
                  {
                    src: '/moon/variablesmanagement.jpg',
                    alt: 'Tag component',
                  },
                  {
                    src: '/moon/variables.jpg',
                    alt: 'Variables',
                  },
                ],
              },
            ]}
          />

          <CaseStudy
            title='Fudy Order & Pay'
            description={[
              <>I led the product design of a QR-ordering product for restaurants, bars and other venues.</>,
              <>Fudy was transitioning from a food delivery service, where customer and restaurant staff interactions were entirely online. With <span>Order & Pay</span>, we focused on creating an immediate, personal in-person dining experience.</>,
              <><Link to='/docs/fudy'>Read case study here</Link></>
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Lead Product Designer',
              },
              {
                label: 'Year',
                value: '2023-2024',
              },
              {
                label: 'Focus',
                value: 'QR ordering flows, Figma components, and white-label theming',
              },
            ]}
            media={[
              {
                layout: 'stack',
                images: [
                  {
                    src: '/fudy/story-reference-1.jpg',
                    alt: 'Fudy Order & Pay',
                  },
                  {
                    src: '/fudy/story-reference-2.jpg',
                    alt: 'Fudy Order & Pay',
                  },
                  {
                    src: '/fudy/story-reference-3.jpg',
                    alt: 'Fudy Order & Pay',
                  },
                ],
              },
              {
                layout: 'grid-3',
                images: [
                  {
                    src: '/fudy/customer-interface.jpg',
                    alt: 'Customer interface',
                  },
                  {
                    src: '/fudy/ordering-flow.jpg',
                    alt: 'Ordering flow',
                  },
                  {
                    src: '/fudy/product-view.jpg',
                    alt: 'Product view',
                  },
                ],
              },
              {
                layout: 'stack',
                images: [
                  {
                    src: '/fudy/story-reference-4.jpg',
                    alt: 'Fudy Order & Pay',
                  },
                ],
              },
            ]}
          />

          <CaseStudy
            title='Tempus'
            description={[
              <>Tempus operates in the Web3 space. I contributed as a contractor to three DeFi projects: Nostra, WenWin, and Raft.</>,
              <><span>Nostra</span> is a decentralized exchange for lending, borrowing and trading crypto. <span>WenWin</span> is a blockchain lottery on Ethereum network and <span>Raft</span> is a platform to deposit collateral and earn yield.</>,
              <>Web3 design was challenging since most UX patterns did not exist yet. I focused on incorporating gamification elements like token rewards while ensuring the interfaces remained intuitive for everyday users.</>,
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Product Designer',
              },
              {
                label: 'Year',
                value: '2022-2023',
              },
              {
                label: 'Focus',
                value: 'DeFi product design',
              },
            ]}
            images={[
              {
                src: '/tempus/nostra.jpg',
                alt: 'Nostra',
              },
              {
                src: '/tempus/wenwin.jpg',
                alt: 'WenWin',
              },
              {
                src: '/tempus/raft.jpg',
                alt: 'Raft',
              },
            ]}
          />

          <CaseStudy
            title='Freya Foodbar'
            description={[
              <>Designed and implemented the website in WordPress using Elementor templates and reusable page structures.</>,
              <>Additionally, I built a dynamic daily menu system with <span>ACF</span> that supports separate menu structures for different audiences.</>,
              <>The setup lets staff manage menus from a central options page, while custom PHP logic filters the current week and hides past days automatically.</>,
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Designer and Developer',
              },
              {
                label: 'Year',
                value: '2024',
              },
              {
                label: 'Stack',
                value: 'WordPress, Elementor, ACF',
              },
            ]}
            images={[
              {
                src: '/freya/functions.jpg',
                alt: 'Function to display menu',
              },
              {
                src: '/freya/acf.jpg',
                alt: 'ACF plugin fields',
              },
              {
                src: '/freya/menu.jpg',
                alt: 'Front-end menu display',
              },
            ]}
          />

          <CaseStudy
            title='Motiveer'
            description={[
              <>Motiveer is an AI-powered employee development platform. I designed a landing page and created visual content with Midjourney.</>,
              <>I used the Niji 5 model for anime-driven, character-focused compositions that matched the brand direction.</>,
              <>With the UI design, I wanted Motiveer to feel lightweight and promising to visitors.</>,
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Designer',
              },
              {
                label: 'Year',
                value: '2023',
              },
              {
                label: 'Website',
                value: 'motiveer.eu',
                href: 'https://motiveer.eu',
              },
            ]}
            media={[
              {
                layout: 'grid-3',
                images: [
                  {
                    src: '/motiveer/creative-1.jpg',
                    alt: 'AI creative',
                  },
                  {
                    src: '/motiveer/creative-2.jpg',
                    alt: 'AI creative',
                  },
                  {
                    src: '/motiveer/creative-3.jpg',
                    alt: 'AI creative',
                  },
                  {
                    src: '/motiveer/creative-4.jpg',
                    alt: 'AI creative',
                  },
                  {
                    src: '/motiveer/creative-5.jpg',
                    alt: 'AI creative',
                  },
                  {
                    src: '/motiveer/creative-6.jpg',
                    alt: 'AI creative',
                  },
                ],
              },
              {
                layout: 'stack',
                images: [
                  {
                    src: '/motiveer/creative-7.jpg',
                    alt: 'UI design',
                  },
                  {
                    src: '/motiveer/creative-8.jpg',
                    alt: 'UI design',
                  },
                ],
              },
            ]}
          />

          <CaseStudy
            title='Fiizy'
            description={[
              <>Fiizy worked on fintech products, primarily as a marketplace for financial products and services.</>,
              <>I was mainly doing UI design for lending applications in different markets, alongside coding and designing HTML emails.</>,
              <>Later, I contributed to Fiizy\'s shift into <span>Buy Now, Pay Later</span> by designing a checkout concept and a rebranded website for the product.</>,
            ]}
            meta={[
              {
                label: 'Role',
                value: 'Designer',
              },
              {
                label: 'Year',
                value: '2019-2022',
              },
              {
                label: 'Website',
                value: 'fiizy.com',
                href: 'https://fiizy.com',
              },
            ]}
            media={[
              {
                layout: 'stack',
                images: [
                  {
                    src: '/fiizy/bnpl.jpg',
                    alt: 'Buy now pay later',
                  },
                  {
                    src: '/fiizy/fiizy-pay.jpg',
                    alt: 'Fiizy Pay',
                  },
                ],
              },
              {
                layout: 'grid-3',
                images: [
                  {
                    src: '/fiizy/finzmo-1.jpg',
                    alt: 'Finzmo',
                  },
                  {
                    src: '/fiizy/finzmo-2.jpg',
                    alt: 'Finzmo',
                  },
                  {
                    src: '/fiizy/finzmo-3.jpg',
                    alt: 'Finzmo',
                  },
                ],
              },
              {
                layout: 'stack',
                images: [
                  {
                    src: '/fiizy/kasowo.jpg',
                    alt: 'Kasowo',
                  },
                  {
                    src: '/fiizy/medimas.jpg',
                    alt: 'Medimas',
                  },
                ],
              },
            ]}
          />
        </div>
      </section>
    </div>
  )
}

export default Home