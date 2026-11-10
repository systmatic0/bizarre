import { useEffect, useMemo, useState } from 'react'

type PhotoCategory = 'color' | 'bw'

const colorPhotos = Array.from({ length: 28 }, (_, index) => ({
  src: `/photos/color/image-${index + 1}.jpg`,
  alt: `Color photo ${index + 1}`,
}))

const blackAndWhitePhotos = Array.from({ length: 19 }, (_, index) => ({
  src: `/photos/bw/image-${index + 1}.jpg`,
  alt: `Black and white photo ${index + 1}`,
}))

const GRID_FADE_MS = 220

function Shots() {
  const [activeCategory, setActiveCategory] = useState<PhotoCategory>('color')
  const [displayCategory, setDisplayCategory] = useState<PhotoCategory>('color')
  const [isGridFading, setIsGridFading] = useState(false)
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set())

  const visiblePhotos = useMemo(
    () => (displayCategory === 'color' ? colorPhotos : blackAndWhitePhotos),
    [displayCategory],
  )

  useEffect(() => {
    document.body.classList.toggle('photos-page--desaturated', activeCategory === 'bw')

    return () => {
      document.body.classList.remove('photos-page--desaturated')
    }
  }, [activeCategory])

  useEffect(() => {
    if (activeCategory === displayCategory) return

    setIsGridFading(true)

    const timeout = window.setTimeout(() => {
      setDisplayCategory(activeCategory)
      setIsGridFading(false)
    }, GRID_FADE_MS)

    return () => window.clearTimeout(timeout)
  }, [activeCategory, displayCategory])

  return (
    <div className='photos-page'>
      <section className='photos-hero'>
        <div className='photos-hero__meta'>
          <h1>Shots</h1>
          <p>I take my shots on a film.</p>
        </div>

        <div className='photos-filter' role='tablist' aria-label='Photo categories'>
          <button
            type='button'
            role='tab'
            aria-selected={activeCategory === 'color'}
            className={`photos-filter__button${activeCategory === 'color' ? ' is-active' : ''}`}
            onClick={() => setActiveCategory('color')}
          >
            Color
          </button>

          <button
            type='button'
            role='tab'
            aria-selected={activeCategory === 'bw'}
            className={`photos-filter__button${activeCategory === 'bw' ? ' is-active' : ''}`}
            onClick={() => setActiveCategory('bw')}
          >
            B&amp;W
          </button>
        </div>
      </section>

      <section className='photos-gallery' aria-live='polite'>
        <div className={`photos-grid${isGridFading ? ' photos-grid--fading' : ''}`}>
          {visiblePhotos.map((photo) => (
            <div key={photo.src} className='photos-grid__item container'>
              <img
                src={photo.src}
                alt={photo.alt}
                className={`photos-grid__image${loadedImages.has(photo.src) ? ' is-loaded' : ''}`}
                loading='lazy'
                onLoad={() =>
                  setLoadedImages((previous) => {
                    if (previous.has(photo.src)) return previous
                    const next = new Set(previous)
                    next.add(photo.src)
                    return next
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default Shots