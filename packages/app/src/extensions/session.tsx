import { createEffect, createMemo, on, onCleanup, Show } from "solid-js"
import { useOptionalDesktopExtensions } from "./provider"
import { isExtensionTab } from "./keys"
import { ExtensionSlot } from "./slot"

export function useExtensionPanels(input: {
  serverID: () => string
  sessionID: () => string | undefined
  tabs: () => {
    all(): string[]
    setAll(value: string[]): void
    active(): string | undefined
    setActive(value: string): void
    close(id: string): void
  }
  open(): void
}) {
  const host = useOptionalDesktopExtensions()
  const session = createMemo(() =>
    host?.state.sessions.find(
      (session) => session.sessionID === input.sessionID() && session.server.id === input.serverID(),
    ),
  )
  const panels = createMemo(() => host?.state.panels.filter((panel) => panel.session.key === session()?.key) ?? [])
  createEffect(() => {
    const current = session()
    if (!current || !host) return
    onCleanup(
      host.bind(current, {
        open(id) {
          input.open()
          const tabs = input.tabs()
          if (!tabs.all().includes(id)) tabs.setAll([...tabs.all(), id])
          tabs.setActive(id)
        },
        close: (id) => input.tabs().close(id),
        active: () => input.tabs().active(),
      }),
    )
  })
  createEffect(
    on(
      () => panels().map((panel) => panel.key),
      (keys, previous) => {
        const old = new Set(previous ?? [])
        const tabs = input.tabs()
        // Persisted instances can be waiting for their declarations to mount. Only
        // remove contributions observed disappearing during this route lifetime.
        const removed = new Set(previous?.filter((key) => !keys.includes(key)))
        const current = tabs.all().filter((key) => !removed.has(key))
        const added = keys.filter((key) => !old.has(key) && !current.includes(key))
        if (added.length || current.length !== tabs.all().length) tabs.setAll([...current, ...added])
      },
    ),
  )
  createEffect(
    on(
      () => input.tabs().all(),
      (current, previous) => {
        previous
          ?.filter((key) => isExtensionTab(key) && !current.includes(key))
          .forEach((key) =>
            panels()
              .find((panel) => panel.key === key)
              ?.props.onClose?.(),
          )
      },
    ),
  )
  createEffect(
    on(
      () => input.tabs().active(),
      (active) =>
        panels()
          .find((panel) => panel.key === active)
          ?.props.onSelect?.(),
    ),
  )
  return {
    panels,
    keys: () => panels().map((panel) => panel.key),
    hasActions: () => {
      const value = host?.resolved().slotted.get("session.panel.actions")
      return (
        !!value &&
        (!!value.replace || value.before.length + value.prepend.length + value.append.length + value.after.length > 0)
      )
    },
    declarations: () => (
      <Show when={session()} keyed>
        {(session) => <ExtensionSlot path="session.panel" input={{ session }} />}
      </Show>
    ),
    actions: () => (
      <Show when={session()} keyed>
        {(session) => <ExtensionSlot path="session.panel.actions" input={{ session }} />}
      </Show>
    ),
  }
}

export type SessionExtensions = ReturnType<typeof useExtensionPanels>
