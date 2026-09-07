export type LatLng = [number, number]

export type Bounds = {
  scaleX: number
  minX: number
  minY: number
  span: number
  offsetX: number
  offsetY: number
}

// Longitude degrees shrink as you move away from the equator, so scaling them
// by cos(latitude) keeps a route from looking stretched sideways — the
// equirectangular projection, which is plenty for traces a few kilometres
// across. `points` is whatever the bounding box should be derived from: a
// single track's own points for an independent projection, or every track's
// points pooled together so they all share one box and land at their true
// positions relative to each other. Exported so a caller needing to project
// something else (elevation contour lines, say) into the exact same space as
// a set of tracks can compute the bounds once and reuse them for both.
export function computeBounds(points: LatLng[], size: number, padding: number): Bounds {
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

  return { scaleX, minX, minY, span, offsetX, offsetY }
}

type Point = { x: number; y: number }

// Straight `L` segments between raw, thinned GPS points read as an angular,
// abstract polygon rather than a route — real GPS noise plus the build
// script's thinning (down to ~250 points) leaves sharp little kinks at every
// vertex. A Catmull-Rom spline threads a smooth curve through the same
// points instead of connecting them directly, converted to the cubic Bezier
// segments SVG paths actually support: each interior point's control points
// are nudged along the chord between its neighbours, so the curve passes
// through every original point but arrives and leaves each one tangent to
// its surroundings rather than with a hard corner.
function smoothPath(points: Point[]): string {
  if (points.length < 3) {
    return points.map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  }

  let d = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2

    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    d += ` C${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }

  return d
}

// Projects one lat/lng into the pixel space of a given bounds/size/padding —
// the single-point building block projectPath uses per vertex, exported so a
// caller can place something other than a track (a contour line's vertices)
// into that exact same space.
export function projectPoint([lat, lng]: LatLng, bounds: Bounds, size: number, padding: number): Point {
  const drawable = size - padding * 2
  const { scaleX, minX, minY, span, offsetX, offsetY } = bounds

  return {
    x: offsetX + ((lng * scaleX - minX) / span) * drawable,
    // SVG's y axis points down, latitude points up.
    y: size - (offsetY + ((lat - minY) / span) * drawable),
  }
}

// Projects a track's points into the pixel space of an already-computed
// bounds. Exported so a caller with its own bounds (from computeBounds, to
// share the space with something else already projected with them) can
// project a track's line into it directly.
export function projectPath(points: LatLng[], bounds: Bounds, size: number, padding: number): string {
  if (points.length < 2) return ''
  return smoothPath(points.map((point) => projectPoint(point, bounds, size, padding)))
}

// Projects a single GPS trace onto an SVG viewBox, scaled to its own bounds.
export function toSvgPath(points: LatLng[], size: number, padding: number): string {
  if (points.length < 2) return ''
  return projectPath(points, computeBounds(points, size, padding), size, padding)
}

// Projects several GPS traces onto one shared SVG viewBox: the bounding box
// comes from every track's points pooled together (min/max lat/lng across the
// whole set), so each track lands at its true position and size relative to
// the others rather than being independently rescaled to fill the box on its
// own. Callers should pass only the tracks meant to share a map —
// largestCluster below picks those out.
export function toSvgPaths(tracks: LatLng[][], size: number, padding: number): string[] {
  const allPoints = tracks.flat()
  if (allPoints.length < 2) return tracks.map(() => '')

  const bounds = computeBounds(allPoints, size, padding)
  return tracks.map((points) => projectPath(points, bounds, size, padding))
}

// The raw lat/lng extremes of a set of points — the coordinates a combined
// map's axis labels should show, as opposed to computeBounds' pixel-space
// projection of them.
export function latLngBounds(points: LatLng[]) {
  const lats = points.map(([lat]) => lat)
  const lngs = points.map(([, lng]) => lng)
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
}

function centroid(points: LatLng[]): LatLng {
  const lat = points.reduce((sum, [la]) => sum + la, 0) / points.length
  const lng = points.reduce((sum, [, lo]) => sum + lo, 0) / points.length
  return [lat, lng]
}

// Flat-earth approximation, fine at the scale this compares (tens of
// kilometres, not continents).
function distanceKm(a: LatLng, b: LatLng): number {
  const avgLatRad = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const dx = (b[1] - a[1]) * Math.cos(avgLatRad) * 111.32
  const dy = (b[0] - a[0]) * 110.57
  return Math.sqrt(dx * dx + dy * dy)
}

// A shared map should only pool tracks that are actually near each other —
// pooling in a track from a different city entirely would blow out the
// bounding box and squeeze every nearby route into a corner. This groups
// tracks by their centroid (union-find: any two centroids within
// thresholdKm join the same group, and that's transitive) and returns the
// indices of the largest group, e.g. keeping routes around Keila and Saue
// together while a swim out in Räpina — tens of kilometres further —
// forms its own, excluded group.
export function largestCluster(tracks: LatLng[][], thresholdKm = 15): number[] {
  const n = tracks.length
  if (n <= 1) return tracks.map((_, index) => index)

  const centroids = tracks.map(centroid)
  const parent = Array.from({ length: n }, (_, index) => index)

  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }

  function union(a: number, b: number) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (distanceKm(centroids[i], centroids[j]) <= thresholdKm) union(i, j)
    }
  }

  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }

  return [...groups.values()].sort((a, b) => b.length - a.length)[0]
}
