import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import '../styles/CaseStudy.css'

// Below this the meta panel is laid out statically (see CaseStudy.css), so the
// sticky offset below is irrelevant — `top` is ignored on a static element.
const STICKY_BREAKPOINT = 900

type CaseStudyMetaItem = {
  label: ReactNode
  value: ReactNode
  href?: string
}

type CaseStudyImage = {
  src: string
  alt: string
}

type CaseStudyImageLayout = 'stack' | 'grid-3'

type CaseStudyMediaBlock = {
  layout?: CaseStudyImageLayout
  images: CaseStudyImage[]
}

type CaseStudyProps = {
  title: string
  description: ReactNode[]
  meta?: CaseStudyMetaItem[]
  imageLayout?: CaseStudyImageLayout
  images?: CaseStudyImage[]
  media?: CaseStudyMediaBlock[]
}

function CaseStudy({
  title,
  description,
  meta,
  imageLayout = 'stack',
  images,
  media,
}: CaseStudyProps) {
  const metaRef = useRef<HTMLDivElement | null>(null)
  const metaInnerRef = useRef<HTMLDivElement | null>(null)
  const mediaBlocks = media?.length
    ? media
    : images?.length
      ? [{ layout: imageLayout, images }]
      : []

  // Two things fight a plain `top: 0` here. Sticky offsets resolve against the
  // scroll container's content box, and `.app-scroll` carries a viewport-sized
  // `8vw` padding, so `top: 0` parks the panel ~110px below the top of the
  // screen. And a panel taller than the scrollport can't pin at all — the
  // browser has nowhere to hold it, so it scrolls away partway down the media
  // column. Both fall out of one measurement: subtract the scroller's inset to
  // pin against the real viewport top, and clamp with the panel's own height so
  // an over-tall panel settles with its last line on screen instead of
  // clipping or growing an inner scrollbar.
  useLayoutEffect(() => {
    const metaInner = metaInnerRef.current

    if (!metaInner) {
      return
    }

    const updateStickyOffset = () => {
      if (window.innerWidth <= STICKY_BREAKPOINT) {
        metaInner.style.top = ''
        return
      }

      const scroller = metaInner.closest<HTMLElement>('.app-scroll')
      const scrollerInset = scroller
        ? scroller.getBoundingClientRect().top +
          parseFloat(getComputedStyle(scroller).paddingTop)
        : 0

      const overhang = window.innerHeight - metaInner.offsetHeight
      metaInner.style.top = `${Math.min(0, overhang) - scrollerInset}px`
    }

    updateStickyOffset()

    // Images loading in the other column don't resize the panel, but font
    // swaps and reflow at narrow widths do.
    const resizeObserver = new ResizeObserver(updateStickyOffset)
    resizeObserver.observe(metaInner)
    window.addEventListener('resize', updateStickyOffset)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateStickyOffset)
    }
  }, [description, meta])

  useEffect(() => {
    const metaContainer = metaRef.current

    if (!metaContainer) {
      return
    }

    const metaItems = metaContainer.querySelectorAll('.meta-item')

    if (!metaItems.length) {
      return
    }

    const observer = new IntersectionObserver(
      (entries, currentObserver) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible')
            currentObserver.unobserve(entry.target)
          }
        })
      },
      {
        threshold: 0.1,
      },
    )

    metaItems.forEach((item) => observer.observe(item))

    return () => {
      observer.disconnect()
    }
  }, [meta])

  return (
    <section className='case-study'>
      <div className='case-study__meta'>
        <div ref={metaInnerRef} className='case-study__meta-inner'>
          <div className='case-study__description'>
            <h2 className='case-study__title'>{title}</h2>
            {description.map((paragraph, index) => (
              <p key={`${title}-${index}`}>{paragraph}</p>
            ))}
          </div>

          {meta?.length ? (
            <div ref={metaRef} className='case-study__details'>
              {meta.map((item, index) => (
                <div key={`${title}-meta-${index}`} className='case-study__detail-row meta-item'>
                  <p className='case-study__detail-label'>{item.label}</p>
                  <p className='case-study__detail-value'>
                    {item.href ? (
                      <a href={item.href} target='_blank' rel='noopener noreferrer'>
                        {item.value}
                      </a>
                    ) : (
                      item.value
                    )}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className='case-study__media'>
        {mediaBlocks.map((block, blockIndex) => (
          <div
            key={`${title}-media-${blockIndex}`}
            className={`case-study__media-block case-study__media-block--${block.layout ?? 'stack'}`}
          >
            {block.images.map((image) => (
              <div key={image.src + image.alt} className='case-study__media-item container'>
                <img
                  src={image.src}
                  alt={image.alt}
                  className='case-study-image'
                  loading='lazy'
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

export default CaseStudy