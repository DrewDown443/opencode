import { Popover as Kobalte } from "@kobalte/core/popover"
import { skipToken, useQuery } from "@tanstack/solid-query"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { createMemo, createUniqueId, For, Show, startTransition, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import {
  HOME_SESSION_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/home/sessions/index"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import {
  buildHomeSessionRecords,
  filterHomeSessionRecords,
  homeSessionSearchKey,
  type HomeSessionRecord,
} from "@/home/sessions/records"
import { sessionLabel } from "@/session/title"
import { titlebarRecentSessionsPlacement } from "./titlebar-recent-sessions-popover-position"
import "./titlebar-recent-sessions-popover.css"

const RESULT_LIMIT = 5
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export function TitlebarRecentSessionsPopover(props: {
  server: ServerConnection.Any | undefined
  label: string
  tooltip: JSX.Element
  onCreate: () => void
}) {
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const listID = createUniqueId()
  const popoverID = createUniqueId()
  const [state, setState] = createStore({
    open: false,
    query: "",
    highlighted: "",
    placement: "bottom-start" as "bottom-start" | "bottom-end",
    restoreFocus: true,
    keyboardNavigation: false,
    suppressTriggerHover: false,
  })
  let anchor: HTMLDivElement | undefined
  let button: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined

  const ctx = createMemo(() => (props.server ? global.ensureServerCtx(props.server) : undefined))
  const sessionLoad = useQuery(() => {
    const serverCtx = ctx()
    return {
      queryKey: ["home-sessions", props.server] as const,
      enabled: state.open && !!serverCtx && serverCtx.sdk.connection.status() === "connected",
      queryFn: serverCtx
        ? ({ signal }) =>
            loadHomeSessionIndex((request, options) => serverCtx.sdk.api.session.list(request, options), signal)
        : skipToken,
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    }
  })
  const records = createMemo(() => {
    const server = props.server
    const serverCtx = ctx()
    if (!server || !serverCtx) return []
    const key = ServerConnection.key(server)
    return buildHomeSessionRecords({
      sessions: () =>
        retainHomeSessions(
          serverCtx.data.session.apply(
            mergeHomeSessionIndex(
              sessionLoad.isPending ? [] : (sessionLoad.data?.() ?? []),
              serverCtx.data.session.list(),
            ),
          ),
          HOME_SESSION_LIMIT,
          Date.now(),
        ),
      projectDirectories: () => undefined,
      projects: serverCtx.projects.list,
    }).filter((record) => !sessionHasOpenTab(tabs.store, key, record.session))
  })
  const visible = createMemo(() => filterHomeSessionRecords(records(), state.query).slice(0, RESULT_LIMIT))
  const active = createMemo(() => {
    if (visible().some((record) => homeSessionSearchKey(record) === state.highlighted)) return state.highlighted
    const first = visible()[0]
    return first ? homeSessionSearchKey(first) : ""
  })

  const setOpen = (open: boolean) => {
    if (open) {
      setState({ open: true, restoreFocus: true, keyboardNavigation: false, suppressTriggerHover: false })
      return
    }
    setState({ open: false, query: "", highlighted: "", keyboardNavigation: false })
  }

  const open = (event: MouseEvent) => {
    event.preventDefault()
    const element = anchor
    const rect = element?.getBoundingClientRect()
    if (element && rect) {
      setState(
        "placement",
        titlebarRecentSessionsPlacement({
          left: rect.left,
          right: rect.right,
          viewportWidth: window.innerWidth,
          direction: getComputedStyle(element).direction === "rtl" ? "rtl" : "ltr",
        }),
      )
    }
    setOpen(true)
  }

  const select = (record: HomeSessionRecord) => {
    const server = props.server
    const serverCtx = ctx()
    if (!server || !serverCtx) return
    const key = ServerConnection.key(server)
    void serverCtx.data.session.message.sync(record.session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: key, sessionId: record.session.id })
      tabs.select(tab)
      serverCtx.data.session.remember(record.session)
      serverCtx.projects.open(record.project.worktree)
      serverCtx.projects.touch(record.project.worktree)
    })
    setOpen(false)
  }

  const move = (delta: number) => {
    const list = visible()
    if (list.length === 0) return
    const index = list.findIndex((record) => homeSessionSearchKey(record) === active())
    const next = ((index === -1 ? 0 : index) + delta + list.length) % list.length
    setState({ highlighted: homeSessionSearchKey(list[next]), keyboardNavigation: true })
  }

  return (
    <Kobalte open={state.open} onOpenChange={setOpen} placement={state.placement} gutter={6} modal={false}>
      <Kobalte.Anchor ref={anchor} as="div" class="shrink-0 [app-region:no-drag]" onContextMenu={open}>
        <Tooltip forceOpen={state.open ? false : undefined} placement="bottom" value={props.tooltip}>
          <IconButton
            ref={button}
            type="button"
            data-action="titlebar-new-session"
            data-suppress-hover={state.suppressTriggerHover || undefined}
            variant="ghost-muted"
            size="large"
            state={state.open ? "pressed" : undefined}
            class="shrink-0"
            icon={<Icon name="plus" />}
            onClick={props.onCreate}
            onPointerLeave={() => setState("suppressTriggerHover", false)}
            aria-label={props.label}
            aria-haspopup="dialog"
            aria-expanded={state.open}
            aria-controls={state.open ? popoverID : undefined}
          />
        </Tooltip>
      </Kobalte.Anchor>
      <Kobalte.Portal>
        <Kobalte.Content
          id={popoverID}
          ref={(element) => {
            const root = anchor?.closest("[data-theme]")
            const theme = root?.getAttribute("data-theme")
            const scheme = root?.getAttribute("data-color-scheme")
            if (theme) element.setAttribute("data-theme", theme)
            if (scheme) element.setAttribute("data-color-scheme", scheme)
            element.dir = getComputedStyle(anchor ?? document.documentElement).direction
          }}
          data-component="titlebar-recent-sessions-popover"
          data-keyboard-navigation={state.keyboardNavigation || undefined}
          aria-label={language.t("sidebar.project.recentSessions")}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            input?.focus({ preventScroll: true })
          }}
          onInteractOutside={() => setState("restoreFocus", false)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (state.restoreFocus && button?.matches(":hover")) setState("suppressTriggerHover", true)
            if (state.restoreFocus) button?.focus({ preventScroll: true })
            setState("restoreFocus", true)
          }}
        >
          <label class="flex h-7 min-w-0 items-center gap-2 px-3 text-v2-icon-icon-muted">
            <Icon name="magnifying-glass" />
            <input
              ref={input}
              type="text"
              role="combobox"
              value={state.query}
              class="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] leading-5 tracking-[-0.04px] text-v2-text-text-base outline-none [font-weight:440] placeholder:text-v2-text-text-faint"
              placeholder={language.t("home.sessions.search.placeholder")}
              aria-label={language.t("home.sessions.search.placeholder")}
              aria-controls={listID}
              aria-expanded={state.open}
              aria-autocomplete="list"
              aria-activedescendant={active() ? `${listID}-${active()}` : undefined}
              onInput={(event) =>
                setState({ query: event.currentTarget.value, highlighted: "", keyboardNavigation: true })
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setOpen(false)
                  return
                }
                if (event.altKey || event.metaKey || event.ctrlKey) return
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  move(1)
                  return
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault()
                  move(-1)
                  return
                }
                if (event.key !== "Enter" || event.isComposing) return
                event.preventDefault()
                const record = visible().find((item) => homeSessionSearchKey(item) === active())
                if (record) select(record)
              }}
            />
          </label>
          <div id={listID} role="listbox" aria-label={language.t("sidebar.project.recentSessions")}>
            <Show
              when={visible().length > 0}
              fallback={
                <div class="flex h-7 min-w-0 items-center justify-center overflow-hidden text-ellipsis whitespace-nowrap px-3 text-[13px] text-v2-text-text-muted [font-weight:440]">
                  <Show
                    when={sessionLoad.isPending}
                    fallback={
                      state.query
                        ? language.t("home.sessions.search.noResults", { query: state.query.trim() })
                        : language.t("home.sessions.empty")
                    }
                  >
                    <Spinner class="size-4" />
                  </Show>
                </div>
              }
            >
              <For each={visible()}>
                {(record) => {
                  const key = () => homeSessionSearchKey(record)
                  const title = () => sessionLabel(record.session)
                  return (
                    <button
                      type="button"
                      tabIndex={-1}
                      id={`${listID}-${key()}`}
                      role="option"
                      aria-selected={active() === key()}
                      aria-label={title()}
                      data-component="titlebar-recent-session-row"
                      onPointerMove={() => setState({ highlighted: key(), keyboardNavigation: false })}
                      onClick={() => select(record)}
                    >
                      <SessionTabAvatarView
                        project={record.project}
                        directory={record.session.location.directory}
                        unread={false}
                        loading={false}
                      />
                      <span
                        data-slot="titlebar-recent-session-title"
                        dir="auto"
                        class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
                      >
                        {title()}
                      </span>
                    </button>
                  )
                }}
              </For>
            </Show>
          </div>
        </Kobalte.Content>
      </Kobalte.Portal>
    </Kobalte>
  )
}
