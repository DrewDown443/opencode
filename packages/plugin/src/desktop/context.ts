import type { OpenCodeClient, LocationRef } from "@opencode/client"
import type { Data } from "../tui/context.js"
import type { Accessor, JSX } from "solid-js"
import type { Store } from "solid-js/store"
import type { Rpc } from "@opencode/schema/rpc"
import type { RpcClient } from "./rpc.js"

export type Dispose = () => void
export interface Lifecycle {
  readonly signal: AbortSignal
  own(dispose: Dispose): Dispose
}

export interface Server {
  readonly id: string
  readonly client: OpenCodeClient
  readonly data: Data
  readonly compatible: boolean
}

/** A visited session remains owned by its shell tab, including while another route is shown. */
export interface SessionContext {
  readonly key: string
  readonly ownerID: string
  readonly sessionID: string
  readonly server: Server
  readonly creating: boolean
  readonly location: LocationRef | undefined
}

export interface PanelInput {
  readonly session: SessionContext
}

export interface SlotMap {
  readonly app: Readonly<Record<string, never>>
  readonly "titlebar.actions": Readonly<Record<string, never>>
  readonly "settings.experimental": Readonly<Record<string, never>>
  readonly "session.panel": PanelInput
  readonly "session.panel.actions": PanelInput
  readonly "session.composer.top": PanelInput
}
export type SlotPath = keyof SlotMap
type Placement<Path extends string> = {
  [Kind in "append" | "prepend" | "before" | "after" | "replace"]: { readonly [Key in Kind]: Path } & {
    readonly [Key in Exclude<"append" | "prepend" | "before" | "after" | "replace", Kind>]?: never
  }
}["append" | "prepend" | "before" | "after" | "replace"]
export type SlotClaim<Path extends SlotPath = SlotPath> = Path extends SlotPath
  ? Placement<Path> & { readonly when?: Accessor<boolean>; readonly render: (input: SlotMap[Path]) => JSX.Element }
  : never

export interface Command {
  readonly id: string
  readonly title: string
  readonly description?: string
  readonly group?: string
  readonly bind?: string
  readonly slash?: string
  readonly enabled?: boolean
  readonly palette?: boolean
  readonly run: () => void | Promise<void>
}

export interface Storage {
  store<Value extends object>(
    key: string,
    options: { initial: Value },
  ): readonly [Store<Value>, (update: (draft: Value) => void) => void]
  memory<Value extends object>(
    key: string,
    options: { initial: Value },
  ): readonly [Store<Value>, (update: (draft: Value) => void) => void]
}

export interface Context {
  readonly app: { readonly version?: string; readonly windowID?: string; readonly native: boolean }
  readonly lifecycle: Lifecycle
  readonly sessions: { list(): readonly SessionContext[]; current(): SessionContext | undefined }
  readonly storage: Storage
  readonly commands: { register(commands: Accessor<readonly Command[]>): Dispose; dispatch(id: string): void }
  readonly main: { rpc<D extends Rpc.Definition>(definition: D): RpcClient<D> }
  readonly ui: {
    slot(claim: SlotClaim): Dispose
    readonly panel: {
      open(id: string, session: SessionContext): boolean
      close(id: string, session: SessionContext): boolean
      selected(id: string, session: SessionContext): boolean
    }
  }
  /** Host copy uses the host language; extension-specific copy can be supplied as a fallback. */
  readonly i18n: { locale(): string; t(key: string, params?: Record<string, string | number>): string }
}

export interface PanelProps {
  readonly id: string
  readonly title: string
  readonly icon?: JSX.Element
  readonly badge?: string | number
  readonly loading?: boolean
  readonly onClose?: () => void
  readonly onSelect?: () => void
  readonly children: JSX.Element
}
