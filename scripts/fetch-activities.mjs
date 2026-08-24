// Pulls recent activities from Intervals.icu at build time and writes them to
// public/activities.json, so the browser never sees an API credential.
//
// Intervals.icu auto-syncs from Garmin, and unlike Strava's API it needs no
// OAuth dance and no paid plan — just a personal API key, sent as HTTP basic
// auth with the literal username "API_KEY".
//
// Needs INTERVALS_API_KEY. INTERVALS_ATHLETE_ID is optional: "0" means
// whoever owns the key. Without a key the script is a no-op, so a fork or a
// local `pnpm build` still succeeds, just without fresh activities.

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../public/activities.json')
const API_BASE = 'https://intervals.icu/api/v1'
const LOOKBACK_DAYS = 120
const MAX_TRACKS = 8
// A GPS stream carries a point per second, so an hour's ride is 3600 of them.
// The trace is drawn a couple of hundred pixels wide and every point ships to
// the browser, so thinning it costs nothing visible and saves a lot of bytes.
const MAX_POINTS = 250

const { INTERVALS_API_KEY } = process.env

// `|| '0'` rather than a destructuring default: an unset GitHub Actions secret
// still defines the variable, as an empty string, and a default only fires on
// `undefined`. An empty id silently builds the URL `/athlete//activities`,
// which the API answers with a 404.
const INTERVALS_ATHLETE_ID = process.env.INTERVALS_ATHLETE_ID || '0'

const authHeader = `Basic ${Buffer.from(`API_KEY:${INTERVALS_API_KEY}`).toString('base64')}`

async function api(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${(await response.text()).slice(0, 200)}`)
  }

  return response.json()
}

function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

async function getActivities() {
  const newest = new Date()
  const oldest = new Date(newest.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  return api(
    `/athlete/${INTERVALS_ATHLETE_ID}/activities?oldest=${isoDate(oldest)}&newest=${isoDate(newest)}`,
  )
}

// Intervals.icu returns a list of stream objects, and splits a coordinate pair
// across two parallel arrays: `data` holds the latitudes and `data2` the
// longitudes. The other shapes below are kept as cheap fallbacks in case the
// response ever changes — none of it is contractually documented.
function extractPoints(streams) {
  const list = Array.isArray(streams)
    ? streams
    : Object.entries(streams ?? {}).map(([type, value]) => ({ type, ...(value ?? {}) }))

  const byType = new Map(list.filter((stream) => stream?.type).map((stream) => [stream.type, stream]))

  const latlng = byType.get('latlng')
  if (Array.isArray(latlng?.data)) {
    // The shape Intervals.icu actually returns.
    if (Array.isArray(latlng.data2)) {
      return latlng.data.map((lat, index) => [lat, latlng.data2[index]])
    }
    // Strava-style: one array of [lat, lng] pairs.
    if (Array.isArray(latlng.data[0])) {
      return latlng.data
    }
  }

  const lat = byType.get('lat') ?? byType.get('latitude')
  const lng = byType.get('lng') ?? byType.get('lon') ?? byType.get('longitude')
  if (Array.isArray(lat?.data) && Array.isArray(lng?.data)) {
    return lat.data.map((value, index) => [value, lng.data[index]])
  }

  return []
}

function thin(points) {
  const clean = points.filter(
    ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0),
  )

  if (clean.length <= MAX_POINTS) return clean

  const step = Math.ceil(clean.length / MAX_POINTS)
  const thinned = clean.filter((_, index) => index % step === 0)

  // Keep the true finish so a loop still closes after thinning.
  const last = clean[clean.length - 1]
  if (thinned[thinned.length - 1] !== last) thinned.push(last)

  return thinned
}

function round([lat, lng]) {
  // ~1 m of precision, which is far finer than a 200px trace can show.
  return [Number(lat.toFixed(5)), Number(lng.toFixed(5))]
}

async function toTrack(activity) {
  const streams = await api(`/activity/${activity.id}/streams.json?types=latlng`)
  const points = thin(extractPoints(streams)).map(round)

  if (points.length < 2) return null

  return {
    id: activity.id,
    name: activity.name ?? 'Untitled',
    type: activity.type ?? activity.sport_type ?? 'Activity',
    distance: activity.distance ?? 0,
    movingTime: activity.moving_time ?? 0,
    elevationGain: activity.total_elevation_gain ?? 0,
    startDate: activity.start_date_local ?? activity.start_date,
    points,
  }
}

async function main() {
  if (!INTERVALS_API_KEY) {
    console.log('INTERVALS_API_KEY missing — skipping fetch, leaving public/activities.json as is.')
    return
  }

  const activities = await getActivities()
  console.log(`Intervals.icu returned ${activities.length} activit(ies) in the last ${LOOKBACK_DAYS} days.`)

  // Indoor sessions have no GPS trace. `stream_types` tells us up front, so we
  // avoid a per-activity request that could only come back empty.
  const candidates = activities
    .filter((activity) => !activity.stream_types || activity.stream_types.includes('latlng'))
    .slice(0, MAX_TRACKS)

  const tracks = []
  for (const activity of candidates) {
    try {
      const track = await toTrack(activity)
      if (track) tracks.push(track)
    } catch (error) {
      console.warn(`Skipping activity ${activity.id}: ${error.message}`)
    }
  }

  if (!tracks.length) {
    // Loud, because the likeliest cause is the stream shape differing from
    // what extractPoints() expects — and the site would just silently hide.
    console.warn(
      `::warning::No GPS traces extracted. Stream types seen: ${JSON.stringify(
        [...new Set(activities.flatMap((a) => a.stream_types ?? []))],
      )}`,
    )
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), tracks })}\n`,
  )

  console.log(`Wrote ${tracks.length} track(s) to public/activities.json`)
}

main().catch(async (error) => {
  // An outage or an expired key shouldn't take the whole deploy down — the
  // site just serves whatever activities it last had.
  console.warn(`::warning::Activity fetch failed, keeping existing data: ${error.message}`)

  try {
    await readFile(OUTPUT_PATH)
  } catch {
    await mkdir(dirname(OUTPUT_PATH), { recursive: true })
    await writeFile(OUTPUT_PATH, `${JSON.stringify({ updatedAt: null, tracks: [] })}\n`)
  }
})
