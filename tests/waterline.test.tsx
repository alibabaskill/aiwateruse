import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { dayKey } from '../hooks/water'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
type Surface = (typeof SURFACES)[number]

/** 3 pm UTC on 24 October 2026. */
const NOW = Date.UTC(2026, 9, 24, 15)
const DAY = 86_400_000

const pane = (surface: Surface, placement: 'dock' | 'inline' = 'dock') =>
  ({
    plugin: 'waterline',
    component: 'Pane',
    requestId: 'waterline',
    surface,
    props: {
      title: 'Water',
      isFocused: false,
      bodyColumns: 34,
      placement,
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

/** The engine beneath the plugin, answered from memory. */
function engine(on: On, stored?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, stored)
  const statuses: (string | undefined)[] = []
  const toasts: string[] = []
  const opens: string[] = []
  on('command.register', () => ({ value: { command: 'waterline' } }))
  on('ui.open', (_, e) => {
    opens.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })

  return { clock, statuses, toasts, opens }
}

const usage = (output: number, input = 0, cacheRead = 0, cacheWrite = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  model: 'claude-opus-5-5',
})

const turn = (id: string, u: ReturnType<typeof usage>) =>
  ({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: id, usage: u }) as const

const command = (args: string) =>
  ({
    command: 'waterline',
    args,
    origin: { kind: 'bridge' },
    presentation: { isFullscreen: false, columns: 80 },
  }) as const

const start = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('an empty chat shows an empty glass on every surface and placement', async ($, on) => {
  engine(on)
  await $.session.start(start)

  for (const surface of SURFACES) {
    for (const placement of ['dock', 'inline'] as const) {
      const ui = await $.ui.mount(pane(surface, placement))
      expect(await ui.find({ type: 'Text', text: /0 mL/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Not a drop yet/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('a turn pours in its weighted tokens, and the estimate buttons rescale it', async ($, on) => {
  const { statuses } = engine(on)
  await $.session.start(start)
  // 1,000 output + 2,000 new input x 0.2 + 40,000 cache reads x 0.02 = 2,200 weighted.
  await $.turn.complete(turn('t1', usage(1000, 2000, 40_000)))

  const ui = await $.ui.mount(pane('desktop'))
  // Mid: 2,200 / 500 x 1.3448 mL
  expect((await ui.find({ type: 'Text', text: /^5\.9 mL$/ }))?.text).toBe('5.9 mL')
  expect(await ui.find({ type: 'Text', text: /about a teaspoon/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /This chat: 43k tokens/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+5\.9 mL from the last reply/ })).toBeDefined()

  await ui.press({ key: 'estimate-high' })
  expect(await ui.find({ type: 'Text', text: /^198 mL$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /three-quarters of a glass/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Glass · 79% full/ })).toBeDefined()

  await ui.press({ key: 'estimate-low' })
  expect(await ui.find({ type: 'Text', text: /^1\.1 mL$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /about 23 drops/ })).toBeDefined()
  expect(statuses.at(-1)).toBe('💧 1.1 mL · about 23 drops')
  await ui.unmount()
})

test('the drawing pours just after a turn and is still, and an image, a while later', async ($, on) => {
  const { clock } = engine(on)
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(3000)))

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(pane(surface))
    const svg = await ui.find({ type: 'Svg' })
    expect(String(svg?.props.source)).toContain('class="rise"')
    expect(svg?.props.isInteractive).toBe(true)
    expect(String(svg?.props.alt)).toContain('Glass')
    await ui.unmount()
  }

  await clock.advance(20_000)
  const later = await $.ui.mount(pane('desktop'))
  const still = await later.find({ type: 'Svg' })
  expect(String(still?.props.source)).not.toContain('class="rise"')
  expect(still?.props.isInteractive).toBe(false)
  await later.unmount()
})

test('the terminal draws the vessel in half blocks, docked and inline', async ($, on) => {
  engine(on)
  await $.session.start({ ...start, surface: 'terminal' })
  await $.turn.complete(turn('t1', usage(20_000)))

  for (const placement of ['dock', 'inline'] as const) {
    const ui = await $.ui.mount(pane('terminal', placement))
    const raster = await ui.find({ type: 'Raster' })
    const columns = Number(raster?.props.columns)
    const rows = Number(raster?.props.rows)
    expect(columns > 0 && rows > 0).toBe(true)
    // Three little-endian u32s a cell, base64-encoded.
    expect(String(raster?.props.cells).length).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
    expect(await ui.find({ type: 'Text', text: /54 mL/ })).toBeDefined()
    await ui.unmount()
  }
})

test('crossing into a bigger vessel says so once', async ($, on) => {
  const { toasts, statuses } = engine(on, { preset: 'high' })
  await $.session.start({ ...start, surface: 'mobile' })
  // High: 3,334 output tokens = 300 mL, past a 250 mL glass.
  await $.turn.complete(turn('t1', usage(3334)))
  await $.turn.complete(turn('t2', usage(10)))

  expect(toasts).toEqual(["💧 That's a full glass of water so far."])
  expect(statuses.at(-1)).toBe('💧 301 mL · about a glass (+0.9 mL)')

  const ui = await $.ui.mount(pane('mobile', 'inline'))
  expect(await ui.find({ type: 'Text', text: /Water bottle · 60% full · \+0\.9 mL last reply/ })).toBeDefined()
  expect((await ui.find({ key: 'estimate' }))?.props.label).toBe('High estimate')
  // The one button cycles the estimate: high goes round to low.
  await ui.press({ key: 'estimate' })
  expect((await ui.find({ key: 'estimate' }))?.props.label).toBe('Low estimate')
  expect(await ui.find({ type: 'Text', text: /Glass · under 1% full/ })).toBeDefined()
  await ui.unmount()
})

test('the all-time total shows only once other sessions have added to it', async ($, on) => {
  engine(on, { allTimeWeightedTokens: 100_000 })
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(500)))

  const ui = await $.ui.mount(pane('desktop'))
  // Mid: 100,500 / 500 x 1.3448 mL
  expect(await ui.find({ type: 'Text', text: /All time: 270 mL/ })).toBeDefined()
  await ui.unmount()
})

test('a fresh store shows no today, all-time or week lines', async ($, on) => {
  engine(on)
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(500)))

  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: /All time|Today|Last 7 days/ })).toBeUndefined()
  await ui.unmount()
})

test('today and the last week show where the store has history', async ($, on) => {
  engine(on, { days: { [dayKey(NOW)]: 2000, [dayKey(NOW - 2 * DAY)]: 1000 } })
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(500)))

  const desktop = await $.ui.mount(pane('desktop'))
  // Mid: today's 2,500 weighted tokens / 500 x 1.3448 mL
  expect(await desktop.find({ type: 'Text', text: /Today: 6\.7 mL/ })).toBeDefined()
  const alts = (await desktop.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(alts.some(alt => alt.startsWith('Water by day: '))).toBe(true)
  await desktop.unmount()

  const terminal = await $.ui.mount(pane('terminal'))
  expect(await terminal.find({ type: 'Text', text: /Last 7 days/ })).toBeDefined()
  await terminal.unmount()
})

test('/waterline reset empties the glass and forgets what the store kept', async ($, on) => {
  engine(on, { allTimeWeightedTokens: 100_000, preset: 'high' })
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(5000)))

  const ran = await $.command.run(command('reset'))
  expect(ran.text).toBe('Waterline reset: the glass is empty and everything it saved is gone.')

  const ui = await $.ui.mount(pane('desktop'))
  expect(await ui.find({ type: 'Text', text: /^0 mL$/ })).toBeDefined()
  expect((await ui.find({ key: 'estimate-mid' }))?.props.variant).toBe('primary')
  await ui.unmount()

  // A later session finds nothing left in the store to add to.
  await $.session.start(start)
  await $.turn.complete(turn('t2', usage(500)))
  const later = await $.ui.mount(pane('desktop'))
  expect(await later.find({ type: 'Text', text: /All time|Today/ })).toBeUndefined()
  await later.unmount()
})

test('the panel opens at the start of a session, and /waterline opens it again', async ($, on) => {
  const { opens } = engine(on)
  await $.session.start(start)
  expect(opens).toEqual(['waterline'])

  expect((await $.command.run(command(''))).text).toBe('Water panel open.')
  expect(opens).toEqual(['waterline', 'waterline'])
})

test('odd values in the store are ignored', async ($, on) => {
  engine(on, {
    preset: 'everything',
    allTimeWeightedTokens: 'lots',
    // As JSON from the store would hold them: "__proto__" as an own field.
    days: { ...JSON.parse('{"__proto__": 5, "constructor": 9, "nope": 1}'), [dayKey(NOW)]: -3 },
  })
  await $.session.start(start)

  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'estimate-mid' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: /All time|Today|Last 7 days/ })).toBeUndefined()
  await ui.unmount()
})

test('far-future or impossible days in the store never crowd out today', async ($, on) => {
  const junk: Record<string, number> = { '2026-13-01': 50, '2026-10-32': 50 }
  for (let i = 0; i < 14; i++) junk[`99${String(i).padStart(2, '0')}-12-31`] = 50
  engine(on, { days: { ...junk, [dayKey(NOW - DAY)]: 1000 } })
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(500)))

  const terminal = await $.ui.mount(pane('terminal'))
  // Yesterday and today: the week chart shows; the junk days are gone.
  expect(await terminal.find({ type: 'Text', text: /Last 7 days/ })).toBeDefined()
  await terminal.unmount()
})

test('a turn the engine replays is counted once', async ($, on) => {
  engine(on)
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(1000)))
  await $.turn.complete(turn('t1', usage(1000)))

  const ui = await $.ui.mount(pane('desktop'))
  // Mid: 1,000 / 500 x 1.3448 mL, once.
  expect(await ui.find({ type: 'Text', text: /^2\.7 mL$/ })).toBeDefined()
  await ui.unmount()
})

test('only a bare /waterline brings back the panel at the start of later sessions', async ($, on) => {
  const { opens } = engine(on, { autoOpen: false })
  await $.session.start(start)
  expect(opens).toEqual([])

  await $.command.run(command('high'))
  expect(opens).toEqual(['waterline'])
  await $.session.start(start)
  expect(opens).toEqual(['waterline'])

  await $.command.run(command(''))
  await $.session.start(start)
  expect(opens).toEqual(['waterline', 'waterline', 'waterline'])
})

test('another plugin running /waterline can open the panel but not reset or change it', async ($, on) => {
  const { opens } = engine(on, { allTimeWeightedTokens: 100_000, preset: 'high' })
  await $.session.start(start)
  const fromPlugin = (args: string) => ({ ...command(args), origin: { kind: 'plugin', name: 'other' } }) as const

  expect((await $.command.run(fromPlugin('reset'))).text).toBe('Only you can change or reset Waterline.')
  expect((await $.command.run(fromPlugin('low'))).text).toBe('Only you can change or reset Waterline.')
  expect((await $.command.run(fromPlugin(''))).text).toBe('Water panel open.')
  expect(opens).toEqual(['waterline', 'waterline'])

  await $.turn.complete(turn('t1', usage(500)))
  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'estimate-high' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: /All time/ })).toBeDefined()
  await ui.unmount()
})

test('a store that fails still starts the session, draws and opens the panel', async ($, on) => {
  mock.clock(on, { now: NOW })
  const opens: string[] = []
  on('store.get', () => {
    throw new Error('store unreadable')
  })
  on('store.set', () => {
    throw new Error('store unwritable')
  })
  on('command.register', () => ({ value: { command: 'waterline' } }))
  on('ui.open', (_, e) => {
    opens.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start(start)
  expect(opens).toEqual(['waterline'])
  await $.turn.complete(turn('t1', usage(1000)))

  const ui = await $.ui.mount(pane('desktop'))
  // The store's totals were lost, but this chat's glass still counts.
  expect(await ui.find({ type: 'Text', text: /^2\.7 mL$/ })).toBeDefined()
  await ui.unmount()

  expect((await $.command.run(command(''))).text).toBe(
    "Water panel open, but Waterline couldn't save that it should open next time.",
  )
  expect((await $.command.run(command('high'))).text).toBe("Waterline couldn't save that just now; try again in a moment.")
  expect(opens).toEqual(['waterline', 'waterline', 'waterline'])
})

test('odd token counts are ignored, and huge ones still read sensibly', async ($, on) => {
  engine(on)
  await $.session.start(start)
  await $.turn.complete(turn('t1', usage(Number.NaN, -5, Number.POSITIVE_INFINITY)))

  const empty = await $.ui.mount(pane('desktop'))
  expect(await empty.find({ type: 'Text', text: /^0 mL$/ })).toBeDefined()
  await empty.unmount()

  await $.turn.complete(turn('t2', usage(1e15)))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount(pane(surface))
    expect(await ui.find({ type: 'Text', text: /Olympic pools/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/waterline high sets the estimate; anything else gets the usage line', async ($, on) => {
  engine(on)
  await $.session.start(start)
  expect((await $.command.run(command('high'))).text).toBe('Water estimate set to High.')
  expect((await $.command.run(command('<svg onload=alert(1)>'))).text).toBe(
    'Usage: /waterline, or /waterline low | mid | high | reset',
  )

  const ui = await $.ui.mount(pane('desktop'))
  expect((await ui.find({ key: 'estimate-high' }))?.props.variant).toBe('primary')
  await ui.unmount()
})

test('the details explain the estimate and link the sources', async ($, on) => {
  engine(on)
  await $.session.start(start)

  const ui = await $.ui.mount(pane('desktop'))
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: /doesn't publish a water figure/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /makes no network requests/ })).toBeDefined()
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.unmount()
})
