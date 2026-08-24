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

const { INTERVALS_API_KEY, INTERVALS_ATHLETE_ID = '0' } = process.env

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

// The streams response isn't documented in detail, so accept the shapes it
// plausibly takes: a list of stream objects, a map keyed by type, and either a
// combined `latlng` stream or separate `lat`/`lng` ones.
function extractPoints(streams) {
  const byType = Array.isArray(streams)
    ? Object.fromEntries(streams.filter((s) => s?.type).map((s) => [s.type, s.data]))
    : Object.fromEntries(Object.entries(streams ?? {}).map(([key, value]) => [key, value?.data ?? value]))

  const latlng = byType.latlng
  if (Array.isArray(latlng) && Array.isArray(latlng[0])) {
    return latlng
  }

  const lat = byType.lat ?? byType.latitude
  const lng = byType.lng ?? byType.lon ?? byType.longitude
  if (Array.isArray(lat) && Array.isArray(lng)) {
    return lat.map((value, index) => [value, lng[index]])
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
