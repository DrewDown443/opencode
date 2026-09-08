import { AuxiliaryPanel } from "@opencode/ui/auxiliary-panel"
import type { ComponentProps } from "solid-js"

export function TerminalSurface(props: ComponentProps<typeof AuxiliaryPanel>) {
  return <AuxiliaryPanel {...props} id="terminal-panel" data-component="terminal-panel" />
}
