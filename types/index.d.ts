/** Which published figure the water estimate is based on. */
export type Preset = 'low' | 'mid' | 'high'

/** What this chat has used so far, counted in weighted tokens (output = 1). */
export type Tally = {
  /** Weighted tokens counted in this chat. */
  eq: number
  /** The same before the latest turn, so the drawing can pour the difference in. */
  prevEq: number
  /** Raw tokens counted: input, output and cache together. */
  tokens: number
  /** When the latest turn was counted, in `$.clock.now()` milliseconds; 0 before any. */
  pouredAt: number
}

declare module 'claude-code' {
  interface PluginState {
    waterline: {
      tally: Shaped<Tally>
      preset: Preset
      /** Weighted tokens over every session this plugin's store has seen. */
      allTime: number
      /** Weighted tokens by local day ("2026-10-24"), the last two weeks. */
      days: Shaped<Record<string, number>>
      showInfo: boolean
      /** The ids of the last turns counted, so a replayed turn counts once. */
      seen: Shaped<string[]>
    }
  }
}
