import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import {
  createEffect,
  createMemo,
  createResource,
  createUniqueId,
  For,
  Index,
  on,
  onCleanup,
  Show,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useData, useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useSettings } from "@/settings/model"
import { pluginLabel } from "@/providers/catalog/plugin"
import { useMcpToggle } from "@/providers/connect/mcp"
import { configuredLsps } from "./configured-lsp"

const services = [
  { type: "mcp", icon: "mcp", label: "session.summary.mcp" },
  { type: "plugins", icon: "cube", label: "session.summary.plugins" },
  { type: "skills", icon: "post-skill", label: "session.summary.skills" },
  { type: "lsp", icon: "code", label: "session.summary.lsp" },
] as const

type Service = (typeof services)[number]["type"]

export function SessionServerPanel(props: { directory: string; shown: boolean; mobile?: boolean }) {
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const settings = useSettings()
  const contentID = createUniqueId()
  const expanded = settings.sessionSummary.serverExpanded
  const name = createMemo(() => {
    const servers = global.servers.list()
    if (servers.length < 2) return language.t("session.summary.server")
    return serverName(servers.find((connection) => ServerConnection.key(connection) === server.key) ?? server.conn)
  })
  const [store, setStore] = createStore<{ submenu?: Service }>({})
  createEffect(on([() => props.directory, () => props.shown, expanded], () => setStore("submenu", undefined)))

  return (
    <section class="session-summary-card" data-section="server">
      <button
        type="button"
        class="session-summary-row session-summary-heading"
        aria-expanded={expanded()}
        aria-controls={contentID}
        onClick={() => settings.sessionSummary.setServerExpanded(!expanded())}
      >
        <Icon name="server" class="shrink-0 text-v2-icon-icon-muted" />
        <span dir="auto" class="min-w-0 truncate">
          {name()}
        </span>
        <Icon name="fill-triangle-down" size="small" class="session-summary-disclosure" />
      </button>
      <Show when={expanded()}>
        <div id={contentID} class="session-summary-rows">
          <For each={services}>
            {(service) => (
              <Popover
                open={store.submenu === service.type}
                onOpenChange={(open) => setStore("submenu", open ? service.type : undefined)}
                placement={props.mobile ? "top-end" : language.direction() === "rtl" ? "right-start" : "left-start"}
                gutter={4}
                overflowPadding={16}
                modal={false}
              >
                <Popover.Trigger as="button" type="button" class="session-summary-row">
                  <Icon name={service.icon} class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="session-summary-label">{language.t(service.label)}</span>
                  <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    class="session-service-menu"
                    data-service={service.type}
                    aria-label={language.t(service.label)}
                  >
                    <Show when={store.submenu === service.type}>
                      <ServiceMenu kind={service.type} directory={props.directory} />
                    </Show>
                  </Popover.Content>
                </Popover.Portal>
              </Popover>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function ServiceMenu(props: { kind: Service; directory: string }) {
  if (props.kind === "mcp") return <McpMenu directory={props.directory} />
  if (props.kind === "lsp") return <LspMenu directory={props.directory} />
  return <ServiceCatalog kind={props.kind} directory={props.directory} />
}

function LspMenu(props: { directory: string }) {
  const data = useData()
  const sdk = useServerSDK()
  const language = useLanguage()
  const [load, { refetch }] = createResource(
    () => props.directory,
    (directory) => {
      data.location.config.invalidate({ directory })
      return data.location.config.sync({ directory })
    },
  )
  const names = createMemo(() => configuredLsps(data.location.config.list({ directory: props.directory }) ?? []))
  createEffect(() => {
    onCleanup(sdk.event.location(props.directory).on("config.updated", () => void refetch()))
  })
  return (
    <ServiceContent loading={load.loading} error={load.error} retry={refetch}>
      <Show
        when={names().length}
        fallback={<div class="session-service-message">{language.t("session.summary.lsp.empty")}</div>}
      >
        <div class="session-service-message">{language.t("session.summary.lsp.configured")}</div>
        <For each={names()}>
          {(name) => (
            <div class="session-service-row">
              <span dir="auto" class="session-summary-label">
                {name}
              </span>
            </div>
          )}
        </For>
      </Show>
      <div class="session-service-message">{language.t("session.summary.lsp.manage")}</div>
    </ServiceContent>
  )
}

function McpMenu(props: { directory: string }) {
  const data = useData()
  const language = useLanguage()
  const toggle = useMcpToggle(() => props.directory)
  const [load, { refetch }] = createResource(
    () => props.directory,
    (directory) => {
      data.location.mcp.server.invalidate({ directory })
      return data.location.mcp.server.sync({ directory })
    },
  )
  const servers = createMemo(() =>
    (data.location.mcp.server.list({ directory: props.directory }) ?? []).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
  )

  return (
    <ServiceContent loading={load.loading} error={load.error} retry={refetch}>
      <Show
        when={servers().length}
        fallback={
          <div class="session-service-message">
            <p>{language.t("session.summary.mcp.empty")}</p>
            <p>{language.t("session.summary.mcp.add")}</p>
          </div>
        }
      >
        <Index each={servers()}>
          {(server) => {
            const enabled = () => server().status.status !== "disabled"
            const pending = () => toggle.isPending || server().status.status === "pending"
            const error = () => {
              const status = server().status
              return status.status === "failed" ? status.error : undefined
            }
            const label = () => {
              const status = server().status.status
              if (status === "failed") return language.t("session.summary.failed")
              if (status === "pending") return language.t("session.summary.connecting")
              if (status === "needs_auth") return language.t("session.summary.needsAuth")
              return undefined
            }
            const change = (value: boolean) => {
              if (pending()) return
              toggle.mutate({ name: server().name, enabled: value })
            }
            return (
              <Switch
                class="session-mcp-row [&_[data-slot=switch-description]]:sr-only"
                description={label()}
                checked={enabled()}
                // Readonly preserves keyboard focus while the server confirms the toggle.
                readOnly={pending()}
                aria-disabled={pending()}
                aria-busy={toggle.isPending}
                onChange={change}
                onClick={(event: MouseEvent) => {
                  // Label and control clicks already toggle; handle the row's padding here.
                  if (event.target === event.currentTarget) change(!enabled())
                }}
                title={error() ?? server().name}
              >
                <span class="session-service-dot" data-status={server().status.status} aria-hidden="true" />
                <span dir="auto" class="session-summary-label">
                  {server().name}
                </span>
                <Show when={label()}>
                  {(status) => (
                    <span class="session-service-status" aria-hidden="true">
                      {status()}
                    </span>
                  )}
                </Show>
              </Switch>
            )
          }}
        </Index>
      </Show>
    </ServiceContent>
  )
}

function ServiceCatalog(props: { kind: "plugins" | "skills"; directory: string }) {
  const data = useData()
  const sdk = useServerSDK()
  const language = useLanguage()
  const [items, { refetch }] = createResource(
    () => props.directory,
    async (directory) => {
      if (props.kind === "plugins") {
        const result = await sdk.api.plugin.list({ location: { directory } })
        return result.data
          .filter((plugin) => plugin.source.type !== "builtin")
          .map((plugin) => ({
            name: pluginLabel(plugin),
            status: plugin.state.status,
            error: plugin.state.status === "failed" ? plugin.state.error : undefined,
          }))
      }
      data.location.skill.invalidate({ directory })
      await data.location.skill.sync({ directory })
      return (data.location.skill.list({ directory }) ?? []).map((skill) => ({
        name: skill.name,
        status: "active",
        error: undefined,
      }))
    },
  )
  const list = createMemo(() =>
    (items.error ? [] : (items.latest ?? [])).toSorted((a, b) => a.name.localeCompare(b.name)),
  )
  createEffect(() => {
    onCleanup(
      sdk.event
        .location(props.directory)
        .on(props.kind === "plugins" ? "plugin.updated" : "skill.updated", () => void refetch()),
    )
  })
  return (
    <ServiceContent loading={items.loading} error={items.error} retry={refetch}>
      <Show
        when={list().length}
        fallback={
          <div class="session-service-message">
            <p>
              {language.t(props.kind === "plugins" ? "session.summary.plugins.empty" : "session.summary.skills.empty")}
            </p>
            <p>{language.t(props.kind === "plugins" ? "session.summary.plugins.add" : "session.summary.skills.add")}</p>
          </div>
        }
      >
        <div class="session-service-message">
          {language.t(props.kind === "plugins" ? "session.summary.plugins.manage" : "session.summary.skills.manage")}
        </div>
        <For each={list()}>
          {(item) => (
            <div class="session-service-row" title={item.error ?? item.name}>
              <span class="session-service-dot" data-status={item.status} aria-hidden="true" />
              <span dir="auto" class="session-summary-label">
                {item.name}
              </span>
              <Show when={item.status === "failed"}>
                <span class="session-service-status">{language.t("session.summary.failed")}</span>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </ServiceContent>
  )
}

function ServiceContent(props: { loading: boolean; error: unknown; retry: () => unknown; children: JSX.Element }) {
  const language = useLanguage()
  return (
    <Show
      when={!props.loading}
      fallback={
        <div class="session-service-message" role="status">
          {language.t("common.loading")}
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <div class="session-service-message" role="alert">
            <p>{language.t("common.requestFailed")}</p>
            <button type="button" class="session-summary-row" onClick={() => props.retry()}>
              {language.t("session.summary.retry")}
            </button>
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}
