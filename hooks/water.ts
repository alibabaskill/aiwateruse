// Waterline's model, kept free of engine calls so the hooks module and the
// tests share it: how much water a chat's tokens stand for, how to say it,
// and the drawings of the vessel that holds it.
//
// Everything here is pure: no network, no files, no clock. The drawings are
// built from the constants in this file and numbers alone, never from text a
// person or a model wrote.

import type { Preset } from '../types'

export type { Preset }

/** One model turn's token counts, as `turn.complete` reports them. */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** A finite, positive number, or 0: anything else counts as nothing. */
export const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)

// ---------------------------------------------------------------------------
// The estimate

/**
 * Token weights, output = 1: Anthropic's price ratios used as a stand-in for
 * compute. New input costs a fifth of output, a cache write 1.25x new input,
 * a cache read 0.1x new input (the standard rate).
 */
export const WEIGHT = { output: 1, input: 0.2, cacheWrite: 0.25, cacheRead: 0.02 } as const

/** A typical reply, about 400 output tokens plus its prompt, in weighted tokens. */
export const TYPICAL_REPLY = 500

/** Water per typical reply, in millilitres, under each estimate. */
export const PER_REPLY_ML: Record<Preset, number> = {
  // Google, Aug 2025: the median Gemini Apps text prompt, data-centre water only.
  low: 0.26,
  // The same prompt plus the water power plants use making its electricity:
  // 0.24 Wh at 4.52 L per kWh, the 2023 US average.
  mid: 0.26 + 0.24 * 4.52,
  // Mistral, Jul 2025: its life-cycle figure for a 400-token Le Chat reply.
  high: 45,
}

export const PRESETS: readonly Preset[] = ['low', 'mid', 'high']

export const PRESET_LABEL: Record<Preset, string> = { low: 'Low', mid: 'Mid', high: 'High' }

export function isPreset(value: unknown): value is Preset {
  return value === 'low' || value === 'mid' || value === 'high'
}

export function nextPreset(preset: Preset): Preset {
  return preset === 'low' ? 'mid' : preset === 'mid' ? 'high' : 'low'
}

/** A turn's tokens weighted by what they cost to serve; output = 1. */
export function weigh(u: Usage): number {
  return (
    count(u.output_tokens) * WEIGHT.output +
    count(u.input_tokens) * WEIGHT.input +
    count(u.cache_creation_input_tokens) * WEIGHT.cacheWrite +
    count(u.cache_read_input_tokens) * WEIGHT.cacheRead
  )
}

/** Every token a turn read or wrote, cached or not. */
export function rawTokens(u: Usage): number {
  return (
    count(u.input_tokens) +
    count(u.output_tokens) +
    count(u.cache_read_input_tokens) +
    count(u.cache_creation_input_tokens)
  )
}

/** Millilitres of water that many weighted tokens stand for. */
export function mlFor(weighted: number, preset: Preset): number {
  return (count(weighted) / TYPICAL_REPLY) * PER_REPLY_ML[preset]
}

// ---------------------------------------------------------------------------
// The vessels, smallest first

export type VesselId = 'glass' | 'bottle' | 'jug' | 'bucket' | 'bathtub' | 'hottub' | 'pool' | 'olympic'

export type Vessel = {
  id: VesselId
  /** As a heading: "Water bottle". */
  name: string
  /** In a sentence: "water bottle". */
  noun: string
  /** With its article: "a water bottle". */
  a: string
  capacityMl: number
}

export const VESSELS: readonly Vessel[] = [
  { id: 'glass', name: 'Glass', noun: 'glass', a: 'a glass', capacityMl: 250 },
  { id: 'bottle', name: 'Water bottle', noun: 'water bottle', a: 'a water bottle', capacityMl: 500 },
  { id: 'jug', name: 'Jug', noun: 'jug', a: 'a jug', capacityMl: 2_000 },
  { id: 'bucket', name: 'Bucket', noun: 'bucket', a: 'a bucket', capacityMl: 10_000 },
  { id: 'bathtub', name: 'Bathtub', noun: 'bathtub', a: 'a bathtub', capacityMl: 150_000 },
  { id: 'hottub', name: 'Hot tub', noun: 'hot tub', a: 'a hot tub', capacityMl: 1_500_000 },
  { id: 'pool', name: 'Backyard pool', noun: 'backyard pool', a: 'a backyard pool', capacityMl: 50_000_000 },
  { id: 'olympic', name: 'Olympic pool', noun: 'Olympic pool', a: 'an Olympic pool', capacityMl: 2_500_000_000 },
]

const GLASS: Vessel = VESSELS[0]!

/** The smallest vessel that holds this much; the largest past every one. */
export function vesselIndex(ml: number): number {
  const i = VESSELS.findIndex(v => count(ml) <= v.capacityMl)

  return i === -1 ? VESSELS.length - 1 : i
}

export function vesselAt(index: number): Vessel {
  return VESSELS[index] ?? GLASS
}

// ---------------------------------------------------------------------------
// Words

const trim = (n: number, digits: number): string => Number(n.toFixed(digits)).toString()
const group = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** "0.26 mL", "4.2 mL", "214 mL", "1.24 L", "35.2 L", "1,520 L", "2.5 million L". */
export function formatVolume(ml: number): string {
  if (!(count(ml) > 0)) return '0 mL'
  if (ml < 0.01) return 'under 0.01 mL'
  if (ml < 1) return `${trim(ml, 2)} mL`
  if (ml < 9.95) return `${trim(ml, 1)} mL`
  if (ml < 999.5) return `${group(ml)} mL`
  const litres = ml / 1000
  if (litres < 9.995) return `${trim(litres, 2)} L`
  if (litres < 99.95) return `${trim(litres, 1)} L`
  if (litres < 999_500) return `${group(litres)} L`

  return `${trim(litres / 1_000_000, 1)} million L`
}

/** "740", "51.2k", "1.3M". */
export function formatTokens(n: number): string {
  const total = count(n)
  if (total < 1000) return group(total)
  if (total < 999_500) return `${trim(total / 1000, 1)}k`

  return `${trim(total / 1_000_000, 1)}M`
}

/** "half a teaspoon", "a glass", "2.5 glasses", "40 buckets". */
function amountOf(x: number, one: string, many: string): string {
  const r = x < 10 ? Math.round(x * 2) / 2 : Math.round(x)
  if (r <= 0.5) return `half ${one}`
  if (r === 1) return one

  return `${r < 10 ? trim(r, 1) : group(r)} ${many}`
}

/** Something to picture: drops, spoons, glasses, buckets, baths, pools. */
export function compare(ml: number): string {
  if (!(count(ml) > 0)) return 'Not a drop yet'
  if (ml < 2.5) {
    const drops = Math.max(1, Math.round(ml / 0.05))

    return drops === 1 ? 'about a drop' : `about ${drops} drops`
  }
  if (ml < 15) return `about ${amountOf(ml / 5, 'a teaspoon', 'teaspoons')}`
  if (ml < 60) return `about ${amountOf(ml / 15, 'a tablespoon', 'tablespoons')}`
  if (ml < 237.5) {
    const f = ml / 250
    const part =
      f < 0.29 ? 'a quarter of' : f < 0.42 ? 'a third of' : f < 0.58 ? 'half' : f < 0.71 ? 'two-thirds of' : 'three-quarters of'

    return `about ${part} a glass`
  }
  if (ml < 10_000) return `about ${amountOf(ml / 250, 'a glass', 'glasses')}`
  if (ml < 150_000) return `about ${amountOf(ml / 10_000, 'a bucket', 'buckets')}`
  if (ml < 50_000_000) return `about ${amountOf(ml / 150_000, 'a bathtub', 'bathtubs')}`
  if (ml < 2_500_000_000) return `about ${amountOf(ml / 50_000_000, 'a backyard pool', 'backyard pools')}`

  return `about ${amountOf(ml / 2_500_000_000, 'an Olympic pool', 'Olympic pools')}`
}

/** "under 1% full", "38% full", "100% full". */
export function percentFull(frac: number): string {
  const f = count(frac)
  if (!(f > 0)) return 'empty'
  if (f < 0.01) return 'under 1% full'

  return `${Math.min(100, Math.round(f * 100))}% full`
}

/** The line kept under the prompt: the total, and what the last reply added. */
export function statusLine(ml: number, lastMl = 0): string {
  if (!(count(ml) > 0)) return '💧 Not a drop yet'
  const last = count(lastMl) > 0 ? ` (+${formatVolume(lastMl)})` : ''

  return `💧 ${formatVolume(ml)} · ${compare(ml)}${last}`
}

// ---------------------------------------------------------------------------
// Days: what the plugin's store keeps to show today and the last week

/** How many days of totals the store keeps. */
export const HISTORY_DAYS = 14

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

const pad = (n: number): string => String(n).padStart(2, '0')

/** The calendar day a moment falls on where the plugin runs: "2026-10-24". */
export function dayKey(ms: number): string {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A date that exists, in "2026-10-24" form: 2026-02-30 is turned away. */
function isDayKey(day: string): boolean {
  if (!DAY_KEY.test(day)) return false
  const at = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12)

  return dayKey(at.getTime()) === day
}

/**
 * Only real dates in the last HISTORY_DAYS days (tomorrow allowed, for a clock
 * that runs a little fast) with real amounts. A date from a clock that was once
 * badly wrong, or a hand edit, drops out instead of crowding out today.
 */
export function cleanDays(value: unknown, now: number): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  const newest = dayKey(noon.getTime() + DAY_MS)
  const oldest = dayKey(noon.getTime() - (HISTORY_DAYS - 1) * DAY_MS)
  const kept = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, number] =>
        isDayKey(entry[0]) && entry[0] >= oldest && entry[0] <= newest && count(entry[1]) > 0,
    )
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, HISTORY_DAYS + 1)

  return Object.fromEntries(kept)
}

/** Adds weighted tokens to a day, keeping only the recent history. */
export function addToDay(
  days: Record<string, number>,
  day: string,
  weighted: number,
  now: number,
): Record<string, number> {
  return cleanDays({ ...days, [day]: count(days[day]) + count(weighted) }, now)
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** The last seven days, oldest first, ending today. Noon-anchored, so a clock change never skips a day. */
export function lastWeek(days: Record<string, number>, now: number): { day: string; label: string; weighted: number }[] {
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  const week = []
  for (let back = 6; back >= 0; back--) {
    const at = noon.getTime() - back * DAY_MS
    const day = dayKey(at)
    week.push({ day, label: WEEKDAY[new Date(at).getDay()] ?? '', weighted: count(days[day]) })
  }

  return week
}

/** A one-line chart of the week for the terminal: "·▂▅▁▃▇█". */
export function sparkline(values: readonly number[]): string {
  const bars = '▁▂▃▄▅▆▇█'
  const max = Math.max(0, ...values.map(count))

  return values
    .map(v => (count(v) > 0 && max > 0 ? (bars[Math.min(7, Math.floor((count(v) / max) * 7.999))] ?? '█') : '·'))
    .join('')
}

// ---------------------------------------------------------------------------
// The drawing: one 200 x 200 vessel, its water clipped to the inside

const INK = '#8b95a5'
const STROKE = `fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`
const THIN = `fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`
const TINT = `fill="${INK}" fill-opacity=".08"`
const SHINE = `fill="none" stroke="#ffffff" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"`
const SOIL = `fill="#a07c55" fill-opacity=".22"`
const SOLID = `fill="${INK}" fill-opacity=".3" stroke="${INK}" stroke-width="2" stroke-linejoin="round"`

type Shape = {
  /** The inside, where water may be: absolute M, L, Q, C and Z only. */
  inner: string
  /** The water line when full, and the floor. */
  top: number
  bottom: number
  /** How far across the inside reaches, for the surface's wave. */
  left: number
  right: number
  /** Where a drop starts falling from. */
  drop: { x: number; y: number }
  /** Drawn behind the water, and over it. */
  back?: string
  front: string
  /** Rides on the water line (an Olympic pool's lane ropes). */
  surface?: string
  /** For a pool cut into the ground: where the ground starts. */
  ground?: number
}

const GLASS_OUT = 'M56 24 L68 178 Q69 188 79 188 L121 188 Q131 188 132 178 L144 24'
const BOTTLE_OUT =
  'M90 22 L90 36 C90 48 66 52 66 70 L66 180 Q66 192 78 192 L122 192 Q134 192 134 180 L134 70 C134 52 110 48 110 36 L110 22'
const JUG_OUT = 'M40 32 C50 35 57 39 60 45 L54 178 Q53 192 67 192 L133 192 Q147 192 146 178 L140 40'
const BUCKET_OUT = 'M38 62 L58 186 L142 186 L162 62'
const TUB_OUT = 'M22 94 L28 140 Q34 162 60 162 L140 162 Q166 162 172 140 L178 94'
const POOL_BASIN = 'M22 82 L22 128 L96 136 L122 168 L178 168 L178 82'
const OLYMPIC_BASIN = 'M14 88 L14 152 L186 152 L186 88'

function backstrokeFlags(): string {
  let red = ''
  let blue = ''
  for (let i = 0, x = 24; x + 8 <= 176; i++, x += 8) {
    const flag = `M${x} 48 L${x + 4} 56 L${x + 8} 48 Z`
    if (i % 2 === 0) red += flag
    else blue += flag
  }

  return `<path d="${red}" fill="#e5534b" fill-opacity=".75"/><path d="${blue}" fill="#3b82f6" fill-opacity=".75"/>`
}

const SHAPES: Record<VesselId, Shape> = {
  glass: {
    inner: 'M61 27 L72.2 174 Q73 179 78 179 L122 179 Q127 179 127.8 174 L139 27 Z',
    top: 38,
    bottom: 179,
    left: 60,
    right: 140,
    drop: { x: 100, y: 12 },
    back: `<path d="${GLASS_OUT} Z" ${TINT}/>`,
    front:
      `<path d="${GLASS_OUT}" ${STROKE}/>` +
      `<ellipse cx="100" cy="24" rx="44" ry="4" ${THIN}/>` +
      `<path d="M72.6 179.5 L127.4 179.5" stroke="${INK}" stroke-opacity=".45" stroke-width="1.5"/>` +
      `<path d="M66.5 42 L75 160" ${SHINE}/>`,
  },
  bottle: {
    inner:
      'M93.5 24 L93.5 37 C93.5 51 70 55 70 71 L70 179.5 Q70 188 78.5 188 L121.5 188 Q130 188 130 179.5 L130 71 C130 55 106.5 51 106.5 37 L106.5 24 Z',
    top: 48,
    bottom: 188,
    left: 68,
    right: 132,
    drop: { x: 100, y: 10 },
    back: `<path d="${BOTTLE_OUT} Z" ${TINT}/><rect x="66" y="108" width="68" height="34" fill="${INK}" fill-opacity=".14"/>`,
    front:
      `<path d="${BOTTLE_OUT}" ${STROKE}/>` +
      `<path d="M88 22 L112 22 M89 29 L111 29" ${THIN}/>` +
      `<path d="M67.5 108 L132.5 108 M67.5 142 L132.5 142" stroke="${INK}" stroke-opacity=".45" stroke-width="1.5"/>` +
      `<path d="M76 80 L76 170" ${SHINE}/>` +
      `<rect x="146" y="178" width="22" height="13" rx="3" ${SOLID}/>`,
  },
  jug: {
    inner: 'M63 46 L57.5 178 Q57 188 67.5 188 L132.5 188 Q143 188 142.5 178 L137 43 Z',
    top: 56,
    bottom: 188,
    left: 54,
    right: 146,
    drop: { x: 100, y: 12 },
    back: `<path d="${JUG_OUT} Q92 27 40 32 Z" ${TINT}/>`,
    front:
      `<path d="${JUG_OUT}" ${STROKE}/>` +
      `<path d="M40 32 Q92 27 140 40" ${THIN}/>` +
      `<path d="M143 64 C176 62 184 96 178 120 C172 142 160 148 146 150" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M67.5 62 L63 168" ${SHINE}/>`,
  },
  bucket: {
    inner: 'M43 66 L61.2 182 L138.8 182 L157 66 Z',
    top: 74,
    bottom: 182,
    left: 40,
    right: 160,
    drop: { x: 100, y: 12 },
    back: `<path d="${BUCKET_OUT} Z" ${TINT}/>`,
    front:
      `<path d="M40 63 C40 10 160 10 160 63" ${THIN}/>` +
      `<path d="${BUCKET_OUT}" ${STROKE}/>` +
      `<ellipse cx="100" cy="62" rx="62" ry="6" ${THIN}/>` +
      `<path d="M43.2 94 L156.8 94 M51.2 144 L148.8 144" stroke="${INK}" stroke-opacity=".35" stroke-width="2"/>` +
      `<path d="M50 80 L62 170" ${SHINE}/>`,
  },
  bathtub: {
    inner: 'M27 96 L32.5 139 Q38 158 60 158 L140 158 Q162 158 167.5 139 L173 96 Z',
    top: 104,
    bottom: 158,
    left: 26,
    right: 174,
    drop: { x: 55, y: 72 },
    back: `<path d="${TUB_OUT} Z" ${TINT}/>`,
    front:
      `<path d="${TUB_OUT}" ${STROKE}/>` +
      `<rect x="16" y="88" width="168" height="8" rx="4" ${SOLID}/>` +
      `<path d="M58 161 Q54 174 45 180 M142 161 Q146 174 155 180" ${STROKE}/>` +
      `<path d="M30 88 L30 64 Q30 56 38 56 L50 56 Q55 56 55 61 L55 66" ${STROKE}/>`,
  },
  hottub: {
    inner: 'M33 82 L167 82 L167 172 L33 172 Z',
    top: 92,
    bottom: 172,
    left: 32,
    right: 168,
    drop: { x: 100, y: 12 },
    front:
      `<path d="M24 80 L24 186 L176 186 L176 80 L167 80 L167 172 L33 172 L33 80 Z" fill="${INK}" fill-opacity=".22" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>` +
      `<rect x="18" y="74" width="164" height="8" rx="4" ${SOLID}/>` +
      `<path d="M72 64 C66 54 78 48 72 38 C66 28 78 22 72 12 M128 64 C122 54 134 48 128 38 C122 28 134 22 128 12" fill="none" stroke="${INK}" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round"/>`,
  },
  pool: {
    inner: 'M23.5 83 L23.5 126.6 L96.7 134.6 L122.7 166.5 L176.5 166.5 L176.5 83 Z',
    top: 88,
    bottom: 166.5,
    left: 20,
    right: 180,
    drop: { x: 100, y: 30 },
    ground: 82,
    back: `<path fill-rule="evenodd" d="M0 82 L200 82 L200 194 L0 194 Z ${POOL_BASIN} Z" ${SOIL}/>`,
    front:
      `<path d="${POOL_BASIN}" ${STROKE}/>` +
      `<path d="M2 82 L22 82 M178 82 L198 82" ${STROKE}/>` +
      `<rect x="2" y="72" width="40" height="4" rx="2" fill="${INK}" fill-opacity=".55"/>` +
      `<path d="M9 76 L9 82 M16 76 L16 82" ${THIN}/>` +
      `<path d="M150 126 L150 64 Q150 56 158 56 L172 56 Q180 56 180 64 L180 82 M160 126 L160 64 Q160 56 168 56 L182 56 Q190 56 190 64 L190 82" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M150 98 L160 98 M150 112 L160 112" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>` +
      `<path d="M50 82 l2 -6 l2 6 M56 82 l1.5 -5 l1.5 5" fill="none" stroke="#5fa35a" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  olympic: {
    inner: 'M15.5 89 L15.5 150.5 L184.5 150.5 L184.5 89 Z',
    top: 94,
    bottom: 150.5,
    left: 12,
    right: 188,
    drop: { x: 100, y: 24 },
    ground: 88,
    back: `<path fill-rule="evenodd" d="M0 88 L200 88 L200 172 L0 172 Z ${OLYMPIC_BASIN} Z" ${SOIL}/>`,
    front:
      `<path d="${OLYMPIC_BASIN}" ${STROKE}/>` +
      `<path d="M2 88 L14 88 M186 88 L198 88" ${STROKE}/>` +
      `<path d="M22 88 L22 44 M178 88 L178 44 M22 48 L178 48" ${THIN}/>` +
      backstrokeFlags() +
      `<path d="M166 88 L166 80 L182 77 L182 88" ${SOLID}/>`,
    surface: `<path d="M12 0 L188 0" stroke="#f2c94c" stroke-width="3" stroke-dasharray="5 4" stroke-opacity=".9"/>`,
  },
}

const DROP = 'M0 -9 C3.5 -3.5 6 0 6 4 A6 6 0 0 1 -6 4 C-6 0 -3.5 -3.5 0 -9 Z'

const r1 = (n: number): number => Math.round(n * 10) / 10

/** Where the water line sits for a fill, keeping a visible film however little there is. */
function levelOf(s: Shape, frac: number): number {
  const f = Math.min(1, count(frac))

  return f > 0 ? Math.min(s.bottom - 2, s.bottom - f * (s.bottom - s.top)) : s.bottom
}

/**
 * The vessel as an SVG document, filled to `frac` (0 to 1). With `animate`,
 * a drop falls in and the water rises from `prevFrac`; the motion is dropped
 * for a reader who asked for reduced motion.
 */
export function vesselSvg(
  id: VesselId,
  frac: number,
  prevFrac: number,
  { size, animate }: { size: number; animate: boolean },
): string {
  // Only a known vessel's name ever reaches the markup.
  const shape: VesselId = Object.hasOwn(SHAPES, id) ? id : 'glass'
  const s = SHAPES[shape]
  const fill = count(frac)
  const level = levelOf(s, fill)
  const from = levelOf(s, Math.min(count(prevFrac), fill))
  const rise = from - level
  const pour = animate && fill > 0 && rise > 0.25
  const px = Math.round(Math.min(400, Math.max(16, count(size) || 180)))

  let water = ''
  if (fill > 0) {
    const left = s.left - 40
    const right = s.right + 60
    let wave = `M${left} 0 q10 -2.4 20 0`
    for (let x = left + 20; x < right; x += 20) wave += ' t20 0'
    const depth = r1(s.bottom - level + 12)
    const ripple = pour
      ? `<ellipse class="ripple" cx="${s.drop.x}" cy="0" rx="12" ry="2.6" fill="none" stroke="#e6f5ff" stroke-width="1.5"/>`
      : ''
    water =
      `<g clip-path="url(#wl-in-${shape})"><g${pour ? ' class="rise"' : ''}><g transform="translate(0 ${r1(level)})">` +
      `<g${pour ? ' class="wave"' : ''}>` +
      `<path d="${wave} L${right} ${depth} L${left} ${depth} Z" fill="url(#wl-water-${shape})" fill-opacity=".92"/>` +
      `<path d="${wave}" fill="none" stroke="#d4eeff" stroke-opacity=".85" stroke-width="1.5"/>` +
      `</g>${s.surface ?? ''}${ripple}</g></g></g>`
  }

  const motion = pour
    ? '.rise{animation:wl-rise 1.1s cubic-bezier(.25,.8,.3,1) .6s both}' +
      `@keyframes wl-rise{from{transform:translateY(${r1(rise)}px)}to{transform:translateY(0)}}` +
      '.wave{animation:wl-wave 2.4s linear 3}' +
      '@keyframes wl-wave{to{transform:translateX(-40px)}}' +
      '.drop{animation:wl-fall .7s cubic-bezier(.5,0,1,.6) both}' +
      `@keyframes wl-fall{0%{transform:translate(${s.drop.x}px,${s.drop.y}px);opacity:0}15%{opacity:1}90%{opacity:1}` +
      `100%{transform:translate(${s.drop.x}px,${r1(from - 3)}px);opacity:0}}` +
      '.ripple{transform-box:fill-box;transform-origin:center;animation:wl-ripple .9s ease-out .62s both}' +
      '@keyframes wl-ripple{0%{transform:scale(.2);opacity:0}30%{opacity:.9}100%{transform:scale(1.7);opacity:0}}' +
      '@media (prefers-reduced-motion:reduce){.rise,.wave,.drop,.ripple{animation:none}.drop,.ripple{display:none}}'
    : ''
  // Lines hold up when the drawing is shrunk to an icon.
  const thick = px < 100 ? '[stroke]{stroke-width:5}' : ''
  const style = motion || thick ? `<style>${thick}${motion}</style>` : ''
  const drop = pour ? `<g class="drop"><path d="${DROP}" fill="#4f9ff0"/></g>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${px}" height="${px}">` +
    style +
    `<defs><linearGradient id="wl-water-${shape}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#8fd0ff"/><stop offset="1" stop-color="#2a74e0"/></linearGradient>' +
    `<clipPath id="wl-in-${shape}"><path d="${s.inner}"/></clipPath></defs>` +
    (s.back ?? '') +
    water +
    s.front +
    drop +
    '</svg>'
  )
}

/** A small bar chart of the week, today's bar in blue; empty days a short tick. */
export function weekSvg(values: readonly number[]): string {
  const width = 168
  const height = 44
  const gap = 6
  const n = Math.max(1, values.length)
  const barWidth = (width - gap * (n - 1)) / n
  const max = Math.max(0, ...values.map(count))
  const bars = values
    .map((v, i) => {
      const h = max > 0 && count(v) > 0 ? Math.max(3, (count(v) / max) * (height - 6)) : 1.5
      const isToday = i === values.length - 1
      const fill = isToday ? '#3b82f6' : INK
      const opacity = isToday ? '1' : count(v) > 0 ? '.55' : '.3'

      return `<rect x="${r1(i * (barWidth + gap))}" y="${r1(height - h)}" width="${r1(barWidth)}" height="${r1(h)}" rx="2" fill="${fill}" fill-opacity="${opacity}"/>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bars}</svg>`
}

// ---------------------------------------------------------------------------
// The terminal drawing: the same vessel as coloured half-block cells

type Point = readonly [number, number]

/** The polygon of a path of absolute M, L, Q, C and Z commands, curves flattened. */
function polygonOf(d: string): Point[] {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g) ?? []
  const points: Point[] = []
  let at: Point = [0, 0]
  let i = 0
  const num = (): number => Number(tokens[i++])
  while (i < tokens.length) {
    const command = tokens[i++]
    if (command === 'M' || command === 'L') {
      at = [num(), num()]
      points.push(at)
    } else if (command === 'Q') {
      const c: Point = [num(), num()]
      const end: Point = [num(), num()]
      for (let k = 1; k <= 8; k++) {
        const t = k / 8
        const u = 1 - t
        points.push([u * u * at[0] + 2 * u * t * c[0] + t * t * end[0], u * u * at[1] + 2 * u * t * c[1] + t * t * end[1]])
      }
      at = end
    } else if (command === 'C') {
      const c1: Point = [num(), num()]
      const c2: Point = [num(), num()]
      const end: Point = [num(), num()]
      for (let k = 1; k <= 10; k++) {
        const t = k / 10
        const u = 1 - t
        points.push([
          u * u * u * at[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
          u * u * u * at[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
        ])
      }
      at = end
    }
  }

  return points
}

function isInside(poly: readonly Point[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }

  return inside
}

const POLYGONS = new Map<VesselId, Point[]>()

function polygonFor(id: VesselId): Point[] {
  let poly = POLYGONS.get(id)
  if (!poly) {
    poly = polygonOf(SHAPES[id].inner)
    POLYGONS.set(id, poly)
  }

  return poly
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += b === undefined ? '=' : B64[(n >> 6) & 63]!
    out += c === undefined ? '=' : B64[n & 63]!
  }

  return out
}

const DEFAULT_COLOR = 0x01000000
const RGB = (hex: string): number => parseInt(hex.slice(1), 16)
const WALL = RGB(INK)
const EARTH = RGB('#8a7356')
const SURFACE = RGB('#d4eeff')
const TOP_WATER = [0x8f, 0xd0, 0xff] as const
const DEEP_WATER = [0x2a, 0x74, 0xe0] as const

function waterAt(depth: number): number {
  const t = Math.min(1, Math.max(0, depth))
  const mix = (k: 0 | 1 | 2) => Math.round(TOP_WATER[k] + (DEEP_WATER[k] - TOP_WATER[k]) * t)

  return (mix(0) << 16) | (mix(1) << 8) | mix(2)
}

/**
 * The vessel as a Raster for the terminal: its inside from the same outline
 * the SVG clips to, two pixels a cell with half blocks, the shape's own
 * proportions kept. It fits `maxColumns` by `maxRows`, never drawing smaller
 * than 4 columns by 2 rows.
 */
export function vesselRaster(
  id: VesselId,
  frac: number,
  maxColumns: number,
  maxRows: number,
): { columns: number; rows: number; cells: string } {
  const shape: VesselId = Object.hasOwn(SHAPES, id) ? id : 'glass'
  const s = SHAPES[shape]
  const poly = polygonFor(shape)
  const xs = poly.map(p => p[0])
  const ys = poly.map(p => p[1])
  const margin = 5
  const x0 = Math.min(...xs) - margin
  const y0 = Math.min(...ys) - margin
  const x1 = Math.max(...xs) + margin
  const y1 = Math.max(...ys) + margin + (s.ground !== undefined ? 8 : 0)
  const widthPx = Math.max(4, Math.floor(Math.min(512, count(maxColumns) || 24)))
  const heightPx = Math.max(4, Math.floor(Math.min(256, count(maxRows) || 12)) * 2)
  const scale = Math.max((x1 - x0) / widthPx, (y1 - y0) / heightPx)
  // The small allowance keeps rounding from adding a column or row past the room given.
  const columns = Math.max(1, Math.min(widthPx, Math.ceil((x1 - x0) / scale - 1e-9)))
  const pxRows = Math.max(2, Math.min(heightPx, Math.ceil((y1 - y0) / scale - 1e-9)))
  const rows = Math.ceil(pxRows / 2)
  const top = Math.min(...ys)
  const level = levelOf(s, count(frac))
  const surfaceBand = scale * 0.9

  const inside = (cx: number, cy: number): boolean => isInside(poly, x0 + (cx + 0.5) * scale, y0 + (cy + 0.5) * scale)
  const colorAt = (cx: number, cy: number): number | undefined => {
    const x = x0 + (cx + 0.5) * scale
    const y = y0 + (cy + 0.5) * scale
    if (cy >= 0 && cy < pxRows && inside(cx, cy)) {
      if (count(frac) > 0 && y >= level) {
        return y < level + surfaceBand ? SURFACE : waterAt((y - level) / Math.max(1, s.bottom - level))
      }

      return undefined
    }
    // A wall where the inside is next door, below the rim: open at the top.
    if (y >= top) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const nx = cx + dx
        const ny = cy + dy
        if (nx >= 0 && nx < columns && ny >= 0 && ny < pxRows && inside(nx, ny)) return WALL
      }
    }
    if (s.ground !== undefined && y >= s.ground) return EARTH

    return undefined
  }

  const bytes = new Uint8Array(columns * rows * 12)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const upper = colorAt(col, row * 2)
      const lower = row * 2 + 1 < pxRows ? colorAt(col, row * 2 + 1) : undefined
      let glyph = 0x20
      let fg = DEFAULT_COLOR
      let bg = DEFAULT_COLOR
      if (upper !== undefined && upper === lower) {
        glyph = 0x2588
        fg = upper
      } else if (upper !== undefined) {
        glyph = 0x2580
        fg = upper
        bg = lower ?? DEFAULT_COLOR
      } else if (lower !== undefined) {
        glyph = 0x2584
        fg = lower
      }
      view.setUint32(offset, glyph, true)
      view.setUint32(offset + 4, fg, true)
      view.setUint32(offset + 8, bg, true)
      offset += 12
    }
  }

  return { columns, rows, cells: base64(bytes) }
}
