export type HebrewMode = 'on' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'hebrew-rtl': { mode: HebrewMode }
  }
}
