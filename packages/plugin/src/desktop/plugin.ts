import type { Context, Dispose } from "./context.js"

export interface Definition {
  readonly id: string
  readonly setup: (context: Context) => void | Dispose
}

export function define<const T extends Definition>(plugin: T) {
  return plugin
}
