export type LatLng = [number, number]

// Projects a GPS trace onto an SVG viewBox. Longitude degrees shrink as you
// move away from the equator, so scaling them by cos(latitude) keeps the route
// from looking stretched sideways — the equirectangular projection, which is
// plenty for a trace a few kilometres across.
export function toSvgPath(points: LatLng[], size: number, padding: number): string {
  if (points.length < 2) return ''

  const lats = points.map(([lat]) => lat)
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2
  const scaleX = Math.cos((midLat * Math.PI) / 180)

  const xs = points.map(([, lng]) => lng * scaleX)

  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...lats)
  const maxY = Math.max(...lats)

  const span = Math.max(maxX - minX, maxY - minY) || 1
  const drawable = size - padding * 2

  // Centre the smaller axis so a route that runs mostly north-south doesn't
  // hug the left edge of the box.
  const offsetX = padding + (drawable - ((maxX - minX) / span) * drawable) / 2
  const offsetY = padding + (drawable - ((maxY - minY) / span) * drawable) / 2

  return points
    .map(([lat, lng], index) => {
      const x = offsetX + ((lng * scaleX - minX) / span) * drawable
      // SVG's y axis points down, latitude points up.
      const y = size - (offsetY + ((lat - minY) / span) * drawable)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}
