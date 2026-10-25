// Waterline: a glass beside the chat that fills with an estimate of the water
// each reply used.
//
// What this module does, and all it does: at the end of each turn it reads
// the turn's token counts (never the messages), adds them up, and draws the
// total. The only thing it saves is its own small store, a JSON file Claude
// Code keeps for it. It makes no network requests, touches none of your
// files, starts no processes, calls no model and leaves tool calls and
// permissions alone.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Preset, Tally } from '../types'
import {
  PER_REPLY_ML,
  PRESETS,
  PRESET_LABEL,
  VESSELS,
  addToDay,
  cleanDays,
  compare,
  count,
  dayKey,
  formatTokens,
  formatVolume,
  isPreset,
  lastWeek,
  mlFor,
  nextPreset,
  percentFull,
  rawTokens,
  sparkline,
  statusLine,
  vesselAt,
  vesselIndex,
  vesselRaster,
  vesselSvg,
  weekSvg,
  weigh,
  type Usage,
} from './water'

const PANE = 'waterline'
const OPEN = { id: PANE, title: 'Water', rows: 5, columns: 34 } as const

// Everything the plugin's store keeps on this machine, as plain JSON: the
// estimate chosen, whether the panel opens by itself, and totals in weighted
// tokens (all time, and by day for two weeks). Nothing else.
const STORE = {
  preset: 'preset',
  allTime: 'allTimeWeightedTokens',
  days: 'days',
  autoOpen: 'autoOpen',
} as const

const EMPTY: Tally = { eq: 0, prevEq: 0, tokens: 0, pouredAt: 0 }
// Change a shape tag when its value's fields change: it declines what an
// earlier version stored, which outlives a reload.
const tally = atom({ plugin: 'waterline', key: 'tally' } as const, EMPTY, { shape: 'tally-1' })
const preset = atom({ plugin: 'waterline', key: 'preset' } as const, 'mid')
const allTime = atom({ plugin: 'waterline', key: 'allTime' } as const, 0)
const days = atom({ plugin: 'waterline', key: 'days' } as const, {}, { shape: 'days-1' })
const showInfo = atom({ plugin: 'waterline', key: 'showInfo' } as const, false)
// The last turns counted, so a turn the engine replays is counted once.
const seen = atom({ plugin: 'waterline', key: 'seen' } as const, [], { shape: 'seen-1' })
const SEEN_TURNS = 64

/** A drawing made this soon after a turn shows the water pouring in. */
const POUR_MS = 8000

const DETAILS = [
  `Low, ${formatVolume(PER_REPLY_ML.low)} a typical reply: data-centre cooling only, from Google's measured figure for a median Gemini prompt.`,
  `Mid, ${formatVolume(PER_REPLY_ML.mid)}: the same plus the water power plants use making the electricity (0.24 Wh at 4.52 L per kWh, the 2023 US average).`,
  `High, ${formatVolume(PER_REPLY_ML.high)}: Mistral's life-cycle figure for a 400-token reply, the broadest published.`,
  "Each turn's tokens are weighted by Anthropic's price ratios (output 1, new input 0.2, cache writes 0.25, cache reads 0.02); a typical reply counts as 500.",
  'Today and all-time totals stay in this plugin’s own store on this machine, as token counts. Waterline itself makes no network requests.',
  "Anthropic doesn't publish a water figure for Claude, so read this as a rough guide, not a meter.",
] as const

const SOURCES = [
  { href: 'https://arxiv.org/pdf/2508.15734', label: 'Google: water per Gemini prompt (Aug 2025)' },
  {
    href: 'https://simonwillison.net/2025/Jul/22/mistral-environmental-standard/',
    label: "Mistral's life-cycle figures (Jul 2025)",
  },
  {
    href: 'https://www.techtarget.com/it-infrastructure/news/366650693/A-shadow-water-problem-AIs-power-demand-shifts-consumption-upstream',
    label: 'Water used by US power plants (TechTarget)',
  },
] as const

// The store's totals are read, added to and written back one change at a
// time, so turns that end together (subagents) all land.
let storeQueue: Promise<void> = Promise.resolve()

function serially(work: () => Promise<void>): Promise<void> {
  const run = storeQueue.then(work)
  storeQueue = run.catch(() => undefined)

  return run
}

/** The estimate in force: a value that isn't one of the three reads as Mid. */
async function readPreset($: EngineInterface): Promise<Preset> {
  const p: unknown = await read($, preset)

  return isPreset(p) ? p : 'mid'
}

/** Counts one turn's tokens into the glass and the store's totals. */
async function pour($: EngineInterface, usage: Usage): Promise<void> {
  const weighted = weigh(usage)
  if (!(weighted > 0)) return
  const now = await $.clock.now()
  const t = await update($, tally, old => ({
    eq: count(old.eq) + weighted,
    prevEq: count(old.eq),
    tokens: count(old.tokens) + rawTokens(usage),
    pouredAt: now,
  }))
  await serially(async () => {
    const total = count(await $.store.get(STORE.allTime)) + weighted
    const history = addToDay(cleanDays(await $.store.get(STORE.days), now), dayKey(now), weighted, now)
    await $.store.set(STORE.allTime, total)
    await $.store.set(STORE.days, history)
    await update($, allTime, () => total)
    await update($, days, () => history)
  })

  const p = await readPreset($)
  const ml = mlFor(t.eq, p)
  const before = mlFor(t.prevEq, p)
  $.ui.status(statusLine(ml, ml - before))
  const filled = vesselIndex(ml)
  if (filled > vesselIndex(before)) {
    $.ui.toast(`💧 That's a full ${vesselAt(filled - 1).noun} of water so far.`, { timeoutMs: 6000 })
  }
}

async function refreshStatus($: EngineInterface): Promise<void> {
  $.ui.status(statusLine(mlFor((await read($, tally)).eq, await readPreset($))))
}

async function setPreset($: EngineInterface, p: Preset): Promise<void> {
  await update($, preset, () => p)
  await $.store.set(STORE.preset, p)
  await refreshStatus($)
}

/** Empties this chat's glass and forgets everything the store kept. */
async function reset($: EngineInterface): Promise<void> {
  await update($, tally, () => EMPTY)
  await update($, preset, () => 'mid')
  await serially(async () => {
    for (const key of Object.values(STORE)) await $.store.delete(key)
    await update($, allTime, () => 0)
    await update($, days, () => ({}))
  })
  await refreshStatus($)
}

/** Everything a drawing shows, worked out once. */
function describe(t: Tally, p: Preset, all: number, history: Record<string, number>, now: number) {
  const ml = mlFor(count(t.eq), p)
  const index = vesselIndex(ml)
  const vessel = vesselAt(index)
  const frac = ml / vessel.capacityMl
  const amount = formatVolume(ml)
  const fill = percentFull(frac)
  const sincePour = now - t.pouredAt
  const lastMl = ml - mlFor(t.prevEq, p)
  const today = count(history[dayKey(now)])
  const week = lastWeek(history, now)

  return {
    ml,
    vessel,
    next: index + 1 < VESSELS.length ? vesselAt(index + 1) : undefined,
    frac,
    prevFrac: mlFor(t.prevEq, p) / vessel.capacityMl,
    animate: t.pouredAt > 0 && sincePour >= 0 && sincePour < POUR_MS,
    amount,
    comparison: compare(ml),
    fill,
    last: t.pouredAt > 0 && lastMl > 0 ? `+${formatVolume(lastMl)}` : undefined,
    tokens: formatTokens(t.tokens),
    // Other sessions show only where this machine's store has seen them.
    todayMl: today > t.eq + 1 ? mlFor(today, p) : undefined,
    allMl: count(all) > Math.max(t.eq, today) + 1 ? mlFor(all, p) : undefined,
    week:
      week.filter(d => d.weighted > 0).length >= 2
        ? week.map(d => ({ label: d.label, ml: mlFor(d.weighted, p) }))
        : undefined,
    alt: `${vessel.name}, ${fill}: about ${amount} of water used in this chat (an estimate)`,
  }
}

export const register: Register = on => {
  // Each step stands alone: whatever fails, the session starts as it would without Waterline.
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'waterline',
        description: 'Show the water this chat has used; add low, mid or high to change the estimate, or reset',
      })
    } catch {
      // Another plugin holds the name; the panel and status line still work.
    }
    let autoOpen: unknown
    try {
      const [storedPreset, storedAll, storedDays, storedOpen] = await Promise.all([
        $.store.get(STORE.preset),
        $.store.get(STORE.allTime),
        $.store.get(STORE.days),
        $.store.get(STORE.autoOpen),
      ])
      if (isPreset(storedPreset)) {
        const p: Preset = storedPreset
        await update($, preset, () => p)
      }
      const total = count(storedAll)
      const history = cleanDays(storedDays, await $.clock.now())
      await update($, allTime, () => total)
      await update($, days, () => history)
      autoOpen = storedOpen
    } catch {
      // An unreadable store starts the plugin fresh; the session itself is untouched.
    }
    try {
      await refreshStatus($)
    } catch {
      // No status line this time.
    }
    // Closing the panel by hand keeps it closed in later sessions; /waterline brings it back.
    if (autoOpen !== false) void $.ui.open(OPEN).catch(() => undefined)

    return next(e)
  })

  // Every model turn, the main chat's and each subagent's, with what it cost.
  // The engine finishes the turn first; counting it then takes a few quick
  // store calls, and a failure there can't break the turn.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const usage = e.usage
    if (usage) {
      try {
        let isNew = true
        await update($, seen, ids => {
          isNew = !ids.includes(e.turnId)

          return isNew ? [...ids, e.turnId].slice(-SEEN_TURNS) : ids
        })
        if (isNew) await pour($, usage)
      } catch {
        // The glass misses this turn; the chat is untouched.
      }
    }

    return result
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    if (e.origin && e.origin.kind === 'person') {
      try {
        await $.store.set(STORE.autoOpen, false)
      } catch {
        // It opens again next session; nothing else depends on this.
      }
    }

    return closed
  }).catch(($, e, next) => next(e)) // Whatever happens here, the panel closes.

  on('command.run', { command: 'waterline' }, async ($, e) => {
    const asked = e.args.trim().toLowerCase()
    if (asked !== '' && asked !== 'reset' && !isPreset(asked)) {
      return { text: 'Usage: /waterline, or /waterline low | mid | high | reset' }
    }
    // Saved settings change only for the person (typed, from a remote client, or a
    // headless run of theirs), never for another plugin running the command.
    const kind = e.origin?.kind
    const isPerson = kind === 'composer' || kind === 'bridge' || kind === 'sdk'
    if (asked !== '' && !isPerson) return { text: 'Only you can change or reset Waterline.' }

    let opened = true
    try {
      await $.ui.open(OPEN)
    } catch {
      opened = false
    }
    let saved = true
    try {
      if (asked === 'reset') await reset($)
      if (isPreset(asked)) await setPreset($, asked)
      // Only a bare /waterline brings back the panel at the start of later sessions.
      if (asked === '' && isPerson) await $.store.set(STORE.autoOpen, true)
    } catch {
      saved = false
    }
    const done =
      asked === 'reset'
        ? 'Waterline reset: the glass is empty and everything it saved is gone.'
        : isPreset(asked)
          ? `Water estimate set to ${PRESET_LABEL[asked]}.`
          : 'Water panel open.'
    if (!saved) {
      return {
        text:
          asked === ''
            ? `${opened ? 'Water panel open, but ' : ''}Waterline couldn't save that it should open next time.`
            : "Waterline couldn't save that just now; try again in a moment.",
      }
    }
    if (!opened) {
      return { text: asked === '' ? "The water panel couldn't open here." : `${done} The panel couldn't open here.` }
    }

    return { text: done }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const p = await readPreset($)
    const r = describe(await read($, tally), p, await read($, allTime), await read($, days), await $.clock.now())
    const isInfoOpen = (await read($, showInfo)) === true
    const choose = (k: Preset) => () => void setPreset($, k).catch(() => undefined)
    const toggleInfo = () => void update($, showInfo, isOpen => !isOpen).catch(() => undefined)
    const isCompact = e.props.placement === 'inline' || e.props.bodyColumns < 24

    // The terminal: the vessel in coloured half blocks.
    if (e.surface === 'terminal') {
      const { Box, Button, Raster, Text } = $.ui.resolve(e)
      const art = isCompact
        ? vesselRaster(r.vessel.id, r.frac, 12, 5)
        : vesselRaster(r.vessel.id, r.frac, Math.max(12, Math.min(30, e.props.bodyColumns - 2)), 14)
      const vessel = <Raster key="vessel" columns={art.columns} rows={art.rows} cells={art.cells} />

      if (isCompact) {
        return (
          <Box flexDirection="row" gap={2}>
            {vessel}
            <Box flexDirection="column">
              <Text>
                <Text weight="bold">{r.amount}</Text> <Text dimColor>{r.comparison}</Text>
              </Text>
              <Text dimColor>
                {r.vessel.name} · {r.fill}
                {r.last ? ` · ${r.last} last reply` : ''}
              </Text>
              <Box>
                <Button key="estimate" label={`${PRESET_LABEL[p]} estimate`} onPress={choose(nextPreset(p))} />
              </Box>
            </Box>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {vessel}
          <Text>
            <Text weight="bold">{r.amount}</Text> <Text dimColor>{r.comparison}</Text>
          </Text>
          <Text dimColor>
            {r.vessel.name} · {r.fill}
            {r.next ? ` · next: ${r.next.noun}` : ''}
          </Text>
          {r.last && <Text dimColor>{r.last} from the last reply</Text>}
          <Text dimColor>This chat: {r.tokens} tokens</Text>
          {r.todayMl !== undefined && <Text dimColor>Today: {formatVolume(r.todayMl)}</Text>}
          {r.allMl !== undefined && <Text dimColor>All time: {formatVolume(r.allMl)}</Text>}
          {r.week && (
            <Text dimColor>
              Last 7 days <Text color="suggestion">{sparkline(r.week.map(d => d.ml))}</Text>
            </Text>
          )}
          <Box flexDirection="row" gap={1}>
            {PRESETS.map(k => (
              <Button
                key={`estimate-${k}`}
                label={PRESET_LABEL[k]}
                variant={k === p ? 'primary' : 'secondary'}
                onPress={choose(k)}
              />
            ))}
          </Box>
        </Box>
      )
    }

    // The desktop app's Code tab, VS Code, and any app that draws SVG.
    const { Box, Button, Link, Svg, Text } = $.ui.resolve(e)

    if (isCompact) {
      return (
        <Box flexDirection="row" alignItems="center" gap="sm">
          <Svg
            source={vesselSvg(r.vessel.id, r.frac, r.prevFrac, { size: 56, animate: r.animate })}
            alt={r.alt}
            width={56}
            height={56}
            isInteractive={r.animate}
          />
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Text weight="semibold" tabular>
              {r.amount}{' '}
              <Text dimColor weight="regular">
                {r.comparison}
              </Text>
            </Text>
            <Text size="caption" dimColor>
              {r.vessel.name} · {r.fill}
              {r.last ? ` · ${r.last} last reply` : ''}
            </Text>
          </Box>
          <Button key="estimate" label={`${PRESET_LABEL[p]} estimate`} dimColor onPress={choose(nextPreset(p))} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="sm" paddingX={1}>
        <Box justifyContent="center">
          <Svg
            source={vesselSvg(r.vessel.id, r.frac, r.prevFrac, { size: 180, animate: r.animate })}
            alt={r.alt}
            isInteractive={r.animate}
          />
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text size="title" weight="bold" tabular>
            {r.amount}
          </Text>
          <Text dimColor>{r.comparison}</Text>
        </Box>
        <Box flexDirection="column" alignItems="center">
          <Text size="footnote">
            {r.vessel.name} · {r.fill}
          </Text>
          {r.next && (
            <Text size="caption" dimColor>
              Next: {r.next.a} at {formatVolume(r.next.capacityMl)}
            </Text>
          )}
        </Box>
        <Box flexDirection="column" alignItems="center">
          {r.last && (
            <Text size="caption" dimColor>
              {r.last} from the last reply
            </Text>
          )}
          <Text size="caption" dimColor>
            This chat: {r.tokens} tokens
          </Text>
          {r.todayMl !== undefined && (
            <Text size="caption" dimColor>
              Today: {formatVolume(r.todayMl)}
            </Text>
          )}
          {r.allMl !== undefined && (
            <Text size="caption" dimColor>
              All time: {formatVolume(r.allMl)}
            </Text>
          )}
        </Box>
        {r.week && (
          <Box flexDirection="column" alignItems="center" gap="xs">
            <Text size="caption" dimColor>
              Last 7 days
            </Text>
            <Svg
              source={weekSvg(r.week.map(d => d.ml))}
              alt={`Water by day: ${r.week.map(d => `${d.label} ${formatVolume(d.ml)}`).join(', ')}`}
            />
          </Box>
        )}
        <Box flexDirection="row" justifyContent="center" gap="xs">
          {PRESETS.map(k => (
            <Button
              key={`estimate-${k}`}
              label={PRESET_LABEL[k]}
              variant={k === p ? 'primary' : 'secondary'}
              onPress={choose(k)}
            />
          ))}
        </Box>
        <Box justifyContent="center">
          <Button
            key="details"
            label={isInfoOpen ? 'Hide details' : 'How this is estimated'}
            plain
            dimColor
            onPress={toggleInfo}
          />
        </Box>
        {isInfoOpen && (
          <Box flexDirection="column" gap="xs">
            {DETAILS.map(line => (
              <Text size="caption" dimColor>
                {line}
              </Text>
            ))}
            {SOURCES.map(source => (
              <Link href={source.href} label={source.label} />
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
