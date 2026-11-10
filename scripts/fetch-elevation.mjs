// Samples a grid of real elevations over the same tracks ActivityWidget
// overlays on its combined map, and traces contour lines through that grid
// with marching squares — written to public/topo.json at build time, same
// pattern as fetch-activities.mjs (and it must run after that script: it
// reads public/activities.json rather than re-fetching from Intervals.icu).
//
// Elevation comes from OpenTopoData (api.opentopodata.org), a free public API
// over SRTM 30m data — no key needed, so this degrades gracefully (an empty
// topo.json) rather than failing a fork's build the way a missing key would.

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const ACTIVITIES_PATH = resolve(ROOT, '../public/activities.json')
const OUTPUT_PATH = resolve(ROOT, '../public/topo.json')
const ELEVATION_API = 'https://api.opentopodata.org/v1/srtm30m'
const CLUSTER_THRESHOLD_KM = 15
// Grid resolution — each row/batch of ≤100 is one OpenTopoData request (see
// MAX_LOCATIONS_PER_REQUEST below). Marching squares only places a contour
// vertex where the line crosses a grid edge, so a coarse grid gives each
// line very few points to work with — the Catmull-Rom smoothing below still
// runs, but with that few control points between real direction changes it
// reads as short straight segments meeting at sharp kinks rather than a
// curve. Denser sampling gives it enough points along the same terrain to
// actually round the turns.
const GRID_SIZE = 28
const MAX_LOCATIONS_PER_REQUEST = 100
// OpenTopoData's public instance asks for roughly 1 request/second.
const REQUEST_DELAY_MS = 1100
// How far past the tracks' own bounding box to sample, so contour lines
// don't dead-end right at the map's edge — a fraction of the box's own span.
const PADDING_FRACTION = 0.25
// Contour lines are drawn at this many evenly-spaced elevations between the
// sampled grid's own min and max.
const CONTOUR_LEVELS = 12

function centroid(points) {
  const lat = points.reduce((sum, [la]) => sum + la, 0) / points.length
  const lng = points.reduce((sum, [, lo]) => sum + lo, 0) / points.length
  return [lat, lng]
}

function distanceKm(a, b) {
  const avgLatRad = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const dx = (b[1] - a[1]) * Math.cos(avgLatRad) * 111.32
  const dy = (b[0] - a[0]) * 110.57
  return Math.sqrt(dx * dx + dy * dy)
}

// Mirrors largestCluster in src/components/projectRoute.ts — duplicated
// rather than imported since this is a plain Node script and that module is
// TypeScript built for the browser bundle.
function largestCluster(tracks, thresholdKm) {
  const n = tracks.length
  if (n <= 1) return tracks.map((_, index) => index)

  const centroids = tracks.map(centroid)
  const parent = Array.from({ length: n }, (_, index) => index)

  function find(i) {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }
  function union(a, b) {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent[rootA] = rootB
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (distanceKm(centroids[i], centroids[j]) <= thresholdKm) union(i, j)
    }
  }

  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }

  return [...groups.values()].sort((a, b) => b.length - a.length)[0]
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

async function fetchElevations(locations) {
  const elevations = new Array(locations.length)

  for (let start = 0; start < locations.length; start += MAX_LOCATIONS_PER_REQUEST) {
    const batch = locations.slice(start, start + MAX_LOCATIONS_PER_REQUEST)
    const query = batch.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|')

    const response = await fetch(`${ELEVATION_API}?locations=${query}`)
    if (!response.ok) {
      throw new Error(`OpenTopoData request failed with ${response.status}: ${(await response.text()).slice(0, 200)}`)
    }

    const data = await response.json()
    data.results.forEach((result, index) => {
      elevations[start + index] = result.elevation
    })

    if (start + MAX_LOCATIONS_PER_REQUEST < locations.length) await sleep(REQUEST_DELAY_MS)
  }

  return elevations
}

// Linear interpolation of the point along a cell edge where the surface
// crosses `level`, between two corners at values va/vb and positions a/b.
function interpolateEdge(level, va, posA, vb, posB) {
  const t = (level - va) / (vb - va)
  return [posA[0] + t * (posB[0] - posA[0]), posA[1] + t * (posB[1] - posA[1])]
}

// Standard marching squares: for one grid cell, classify its 4 corners as
// above/below `level` into a 4-bit case (TL=8, TR=4, BR=2, BL=1), then look
// up which of the cell's 4 edges the contour crosses for that case and
// interpolate exactly where. Cases 5 and 10 are the ambiguous "saddle"
// cases — two diagonal corners on each side — resolved by which way the
// cell's own average value leans.
function marchingSquaresCell(level, corners, positions) {
  const [tl, tr, br, bl] = corners
  const [posTL, posTR, posBR, posBL] = positions

  const caseIndex = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0)
  if (caseIndex === 0 || caseIndex === 15) return []

  const top = () => interpolateEdge(level, tl, posTL, tr, posTR)
  const right = () => interpolateEdge(level, tr, posTR, br, posBR)
  const bottom = () => interpolateEdge(level, bl, posBL, br, posBR)
  const left = () => interpolateEdge(level, tl, posTL, bl, posBL)

  const average = (tl + tr + br + bl) / 4
  const saddleLeansHigh = average >= level

  switch (caseIndex) {
    case 1: case 14: return [[left(), bottom()]]
    case 2: case 13: return [[bottom(), right()]]
    case 3: case 12: return [[left(), right()]]
    case 4: case 11: return [[top(), right()]]
    case 6: case 9: return [[top(), bottom()]]
    case 7: case 8: return [[top(), left()]]
    case 5: return saddleLeansHigh ? [[top(), right()], [left(), bottom()]] : [[top(), left()], [bottom(), right()]]
    case 10: return saddleLeansHigh ? [[top(), left()], [bottom(), right()]] : [[top(), right()], [left(), bottom()]]
    default: return []
  }
}

// Grid edges are shared between exactly two adjacent cells, so a contour
// crossing that edge gets computed twice — once per cell — from the same two
// corner values and positions, landing on the exact same floating-point
// point both times. That's what makes stitching by exact-match key safe: no
// fuzzy distance matching needed, just a string key.
function pointKey([lat, lng]) {
  return `${lat.toFixed(7)},${lng.toFixed(7)}`
}

// Chains the raw per-cell segments (each just two points) into continuous
// polylines. Real contour segments form simple, non-branching chains — every
// interpolated point sits on exactly one grid edge, shared by at most two
// segments — so a greedy walk in both directions from an arbitrary unused
// segment finds the whole line (or loop) it belongs to. Left as disconnected
// segments, adjacent ones at a slightly coarse grid read as jagged, distinct
// diamonds rather than one line; stitched, the whole level can be threaded
// through smoothPath's Catmull-Rom curve (via projectPath, at render time)
// the same way a GPS track is, rather than staying locked to the grid's own
// straight edges.
function stitchSegments(segments) {
  const byPoint = new Map()
  segments.forEach((segment, index) => {
    const [a, b] = segment
    const keyA = pointKey(a)
    const keyB = pointKey(b)
    if (!byPoint.has(keyA)) byPoint.set(keyA, [])
    if (!byPoint.has(keyB)) byPoint.set(keyB, [])
    byPoint.get(keyA).push({ index, otherPoint: b, otherKey: keyB })
    byPoint.get(keyB).push({ index, otherPoint: a, otherKey: keyA })
  })

  const used = new Set()
  const lines = []

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue
    used.add(i)

    const line = [...segments[i]]

    // Extend off the end, then off the start — each step follows whichever
    // unused segment shares the current endpoint's key.
    let tailKey = pointKey(line[line.length - 1])
    for (let next; (next = (byPoint.get(tailKey) ?? []).find((c) => !used.has(c.index))); ) {
      used.add(next.index)
      line.push(next.otherPoint)
      tailKey = next.otherKey
    }

    let headKey = pointKey(line[0])
    for (let next; (next = (byPoint.get(headKey) ?? []).find((c) => !used.has(c.index))); ) {
      used.add(next.index)
      line.unshift(next.otherPoint)
      headKey = next.otherKey
    }

    lines.push(line)
  }

  return lines
}

// Traces every contour level through the whole grid — grid[row][col] is an
// elevation, positions[row][col] the [lat, lng] it was sampled at (row 0 =
// north, col 0 = west) — and stitches each level's per-cell segments into
// continuous polylines.
function traceContours(grid, positions, levels) {
  const rows = grid.length
  const cols = grid[0].length

  return levels.map((level) => {
    const segments = []

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const corners = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]]
        const positionsForCell = [positions[r][c], positions[r][c + 1], positions[r + 1][c + 1], positions[r + 1][c]]
        segments.push(...marchingSquaresCell(level, corners, positionsForCell))
      }
    }

    return { elevation: level, lines: stitchSegments(segments) }
  })
}

async function main() {
  let activitiesRaw
  try {
    activitiesRaw = JSON.parse(await readFile(ACTIVITIES_PATH, 'utf-8'))
  } catch {
    console.log('public/activities.json missing or unreadable — skipping elevation fetch.')
    return
  }

  const tracks = (activitiesRaw.tracks ?? []).filter((track) => track.points?.length > 1)
  if (tracks.length === 0) {
    console.log('No tracks to build a contour grid around — skipping elevation fetch.')
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify({ updatedAt: new Date().toISOString(), levels: [] })}\n`)
    return
  }

  const clusterIndices = largestCluster(tracks.map((track) => track.points), CLUSTER_THRESHOLD_KM)
  const clusterPoints = clusterIndices.flatMap((index) => tracks[index].points)

  const lats = clusterPoints.map(([lat]) => lat)
  const lngs = clusterPoints.map(([, lng]) => lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  const latPad = (maxLat - minLat) * PADDING_FRACTION || 0.01
  const lngPad = (maxLng - minLng) * PADDING_FRACTION || 0.01
  const gridMinLat = minLat - latPad
  const gridMaxLat = maxLat + latPad
  const gridMinLng = minLng - lngPad
  const gridMaxLng = maxLng + lngPad

  const positions = []
  const locations = []
  for (let r = 0; r < GRID_SIZE; r++) {
    const lat = gridMaxLat - (r / (GRID_SIZE - 1)) * (gridMaxLat - gridMinLat)
    const row = []
    for (let c = 0; c < GRID_SIZE; c++) {
      const lng = gridMinLng + (c / (GRID_SIZE - 1)) * (gridMaxLng - gridMinLng)
      row.push([lat, lng])
      locations.push([lat, lng])
    }
    positions.push(row)
  }

  console.log(`Fetching elevation for a ${GRID_SIZE}x${GRID_SIZE} grid (${locations.length} points)...`)
  const flatElevations = await fetchElevations(locations)

  const grid = []
  for (let r = 0; r < GRID_SIZE; r++) {
    grid.push(flatElevations.slice(r * GRID_SIZE, (r + 1) * GRID_SIZE))
  }

  const minElevation = Math.min(...flatElevations)
  const maxElevation = Math.max(...flatElevations)
  const range = maxElevation - minElevation

  if (range < 1) {
    console.log(`Elevation range is only ${range.toFixed(1)}m — terrain here is too flat for meaningful contours.`)
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(
      OUTPUT_PATH,
      `${JSON.stringify({ updatedAt: new Date().toISOString(), bounds: { minLat: gridMinLat, maxLat: gridMaxLat, minLng: gridMinLng, maxLng: gridMaxLng }, levels: [] })}\n`,
    )
    return
  }

  const levels = Array.from({ length: CONTOUR_LEVELS }, (_, i) => minElevation + ((i + 1) / (CONTOUR_LEVELS + 1)) * range)
  const contours = traceContours(grid, positions, levels)

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify({
      updatedAt: new Date().toISOString(),
      bounds: { minLat: gridMinLat, maxLat: gridMaxLat, minLng: gridMinLng, maxLng: gridMaxLng },
      minElevation,
      maxElevation,
      levels: contours,
    })}\n`,
  )

  console.log(
    `Wrote ${contours.length} contour level(s) (${minElevation.toFixed(0)}–${maxElevation.toFixed(0)}m) to public/topo.json`,
  )
}

main().catch(async (error) => {
  // Same philosophy as fetch-activities.mjs: an API hiccup shouldn't fail the
  // whole deploy — the site just serves whatever contours it last had.
  console.warn(`::warning::Elevation fetch failed, keeping existing data: ${error.message}`)

  try {
    await readFile(OUTPUT_PATH)
  } catch {
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify({ updatedAt: null, levels: [] })}\n`)
  }
})
