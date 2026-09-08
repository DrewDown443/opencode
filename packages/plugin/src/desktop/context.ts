import type { OpenCodeClient, LocationRef } from "@opencode/client"
import type { Data } from "../tui/context.js"
import type { Accessor, JSX } from "solid-js"
import type { Store, SetStoreFunction } from "solid-js/store"
import type { Schema } from "effect"
import type { Rpc } from "@opencode/schema/rpc"
import type { RpcClient } from "./rpc.js"
import type { SessionServices } from "./workspace.js"

export type Dispose = () => void
export interface Lifecycle {
  readonly signal: AbortSignal
  own(dispose: Dispose): Dispose
}

export interface Server {
  readonly id: string
  readonly url: string
  readonly client: OpenCodeClient
  readonly data: Data
  readonly compatible: boolean
  readonly local: boolean
}

/** A visited session remains owned by its shell tab, including while another route is shown. */
export interface SessionContext {
  readonly key: string
  readonly ownerID: string
  readonly sessionID: string
  readonly server: Server
  readonly creating: boolean
  readonly location: LocationRef | undefined
  readonly services?: SessionServices
}

export interface PanelInput {
  readonly session: SessionContext
}

export interface AuxiliaryPresentation {
  readonly stacked?: boolean
  readonly fill?: boolean
  readonly framed?: boolean
  readonly present?: boolean
  readonly contentHeight?: string
  readonly embedded?: boolean
  readonly animate?: boolean
  readonly reserveActions?: boolean
}

export interface SlotMap {
  readonly app: Readonly<Record<string, never>>
  readonly "titlebar.actions": Readonly<Record<string, never>>
  readonly "settings.experimental": Readonly<Record<string, never>>
  readonly "session.panel": PanelInput
  readonly "session.panel.actions": PanelInput
  readonly "session.composer.top": PanelInput
  readonly "session.header.actions": PanelInput
  readonly "session.panel.toolbar": PanelInput
  readonly "session.panel.tools": PanelInput
  readonly "session.sidebar": PanelInput
  readonly "session.auxiliary": PanelInput & {
    readonly services: SessionServices
    readonly presentation: AuxiliaryPresentation
  }
  readonly "session.mobile.actions": PanelInput
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
  /** Optional shared command reference, e.g. a document opener used by other UI. */
  readonly reference?: string
  readonly title: string
  readonly description?: string
  readonly group?: string
  readonly bind?: string
  readonly slash?: string
  readonly enabled?: boolean
  readonly palette?: boolean
  readonly when?: (event: KeyboardEvent) => boolean
  readonly run: () => void | Promise<void>
}

export interface Storage {
  persist<S extends Schema.ConstraintCodec<object, unknown>>(
    key: string,
    schema: S,
    initial: NoInfer<S["Type"]>,
    options?: StorageOptions,
  ): readonly [Store<S["Type"]>, SetStoreFunction<S["Type"]>, Accessor<boolean>]
  remove(key: string, options?: StorageOptions): void
  store<Value extends object>(
    key: string,
    options: { initial: Value },
  ): readonly [Store<Value>, (update: (draft: Value) => void) => void]
  memory<Value extends object>(
    key: string,
    options: { initial: Value },
  ): readonly [Store<Value>, (update: (draft: Value) => void) => void]
}

export interface StorageOptions {
  readonly scope?: { readonly serverID: string; readonly directory: string }
  /** Import an existing host-owned key when extracting a built-in feature. */
  readonly legacyKey?: string
}

export interface Context {
  readonly assets: { url(path: string): string }
  readonly app: { readonly version?: string; readonly windowID?: string; readonly native: boolean }
  readonly lifecycle: Lifecycle
  readonly sessions: { list(): readonly SessionContext[]; current(): SessionContext | undefined }
  readonly servers: { list(): readonly Server[] }
  readonly workspaces: { onRemoved(handler: (value: { serverID: string; directory: string }) => void): Dispose }
  readonly fonts: { console(): string }
  readonly storage: Storage
  readonly commands: {
    register(commands: Accessor<readonly Command[]>): Dispose
    dispatch(id: string): void
    keys(reference: string): string[]
    matches(reference: string, event: KeyboardEvent): boolean
  }
  readonly main: { rpc<D extends Rpc.Definition>(definition: D): RpcClient<D> }
  readonly ui: {
    slot(claim: SlotClaim): Dispose
    readonly toast: {
      show(options: { title: string; message?: string; variant?: "error" | "success" | "default" | "loading" }): void
    }
    readonly panel: {
      open(id: string, session: SessionContext): boolean
      close(id: string, session: SessionContext): boolean
      selected(id: string, session: SessionContext): boolean
      visible(id: string, session: SessionContext): boolean
    }
  }
  readonly platform: {
    readonly platform: "web" | "desktop"
    readonly os?: "macos" | "windows" | "linux"
    readonly webviewZoom?: Accessor<number>
    openExternal(url: string): void
    openLocalFile?(url: string): void
    openPath?(path: string, app?: string): Promise<void>
    revealPath?(path: string): Promise<boolean>
    checkAppExists?(app: string): Promise<boolean>
    saveFile(options: { defaultPath?: string }, content: string): Promise<boolean>
    writeClipboardText?(text: string): Promise<void>
  }
  /** Host copy uses the host language; extension-specific copy can be supplied as a fallback. */
  readonly i18n: {
    locale(): string
    intl(): string
    t(key: string, params?: Record<string, string | number>): string
    plural(key: string, count: number, params?: Record<string, string | number>): string
  }
}

export interface PanelProps {
  readonly id: string
  /** Shared resource reference understood by existing document/command producers. */
  readonly reference?: string
  readonly closable?: boolean
  readonly default?: boolean
  /** Reuse the content owner across related panel instances, such as file previews. */
  readonly group?: string
  /** Available declarations can start closed until another UI opens them. */
  readonly initial?: "open" | "closed"
  readonly onDoubleClick?: () => void
  readonly temporary?: boolean
  readonly title: string
  readonly icon?: JSX.Element
  readonly badge?: string | number
  readonly loading?: boolean
  readonly onClose?: () => void
  readonly onSelect?: () => void
  readonly children: JSX.Element
}
