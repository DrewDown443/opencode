import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useGlobal } from "@/runtime/server/runtime"
import { displayName } from "@/shell/layout/helpers"
import { useSettingsServers } from "./servers/inventory"
import { useSettingsSurface, type SettingsView, type SettingsServerTab } from "./surface"
import { clientSettings, pageLabels, projectSettings, serverSettings } from "./search-catalog"
import { rankSettings, type SettingsSearchResult } from "./search-results"

export function SettingsSearch() {
  const language = useLanguage()
  const platform = usePlatform()
  const global = useGlobal()
  const servers = useSettingsServers()
  const surface = useSettingsSurface()
  const search = surface.search
  const mobile = createMediaQuery("(max-width: 767px)")
  const narrow = createMediaQuery("(max-width: 815px)")
  const [state, setState] = createStore({ highlighted: "" })
  let input: HTMLInputElement | undefined
  let results: HTMLDivElement | undefined
  const inventory = createMemo(() =>
    servers().map((server) => {
      const context = server.connection ? global.ensureServerCtx(server.connection) : undefined
      return {
        ...server,
        connected: context?.sdk.connection.status() === "connected",
        projects: context
          ? [
              ...context.projects.list(),
              ...context.sync.data.project
                .filter((project) => !context.projects.list().some((item) => item.worktree === project.worktree))
                .map((project) => ({ ...project, expanded: false })),
            ]
          : [],
      }
    }),
  )
  const origin = () => search.state.origin ?? surface.view()
  const scopes = createMemo(() => {
    const view = origin()
    return [
      { value: "all", label: language.t("settings.search.scope.all") },
      { value: "app", label: language.t("settings.search.scope.app") },
      ...inventory().map((server) => ({ value: `server:${server.key}`, label: server.name })),
      ...(view.type === "project"
        ? [
            {
              value: `project:${view.server}:${view.project}`,
              label:
                inventory()
                  .find((server) => server.key === view.server)
                  ?.projects.find((project) => project.worktree === view.project)?.name || view.project,
            },
          ]
        : []),
    ]
  })
  const scope = () => (scopes().some((item) => item.value === search.state.scope) ? search.state.scope : "all")
  const catalog = createMemo(() => {
    const items: SettingsSearchResult[] = []
    const add = (
      entry: {
        label: Parameters<typeof language.t>[0]
        keywords?: string
        description?: Parameters<typeof language.t>[0]
      },
      view: SettingsView,
      owner: string,
      server?: string,
      project?: string,
    ) => {
      const page = language.t(
        view.type !== "root" && view.tab === "general" ? "settings.general.section.general" : pageLabels[view.tab],
      )
      items.push({
        id: JSON.stringify([server, project, view.tab, view.target, view.subtab]),
        title: language.t(entry.label),
        description: entry.description ? language.t(entry.description) : "",
        keywords: entry.keywords ?? "",
        owner,
        page,
        server,
        project,
        view,
      })
    }
    clientSettings.forEach((entry) => {
      if (entry.available === "desktop" && platform.platform !== "desktop") return
      if (entry.available === "browser" && !platform.browserPane) return
      if (
        (entry.available === "dev" || entry.available === "mobile-dev") &&
        import.meta.env.VITE_OPENCODE_CHANNEL === "prod"
      )
        return
      if (entry.available === "mobile-dev" && !mobile()) return
      add(entry, { type: "root", tab: entry.tab, target: entry.target }, language.t("settings.search.scope.app"))
    })
    inventory().forEach((server) => {
      const view = (tab: SettingsServerTab, target?: string, subtab?: SettingsView["subtab"]): SettingsView => {
        if (servers().length === 1) return { type: "root", tab: tab === "general" ? "servers" : tab, target, subtab }
        return { type: "server", server: server.key, tab, target, subtab }
      }
      items.push({
        id: `server:${server.key}`,
        title: server.name,
        description: server.connected ? "" : language.t("settings.search.unavailable"),
        keywords: "",
        owner: language.t("status.popover.tab.servers"),
        page: language.t("settings.server.section.connection"),
        server: server.key,
        view: view("general"),
      })
      if (!server.connected) return
      serverSettings.forEach((entry) =>
        add(entry, view(entry.tab, entry.target, entry.subtab), server.name, server.key),
      )
      server.projects.forEach((project) => {
        const destination: SettingsView = {
          type: "project",
          server: server.key,
          project: project.worktree,
          tab: "general",
          parent: servers().length > 1 ? "server" : "root",
        }
        const name =
          server.projects.filter((item) => displayName(item) === displayName(project)).length > 1
            ? `${displayName(project)} · ${project.worktree}`
            : displayName(project)
        const owner = `${server.name} · ${name}`
        items.push({
          id: `project:${server.key}:${project.worktree}`,
          title: displayName(project),
          description: project.worktree,
          keywords: "",
          owner: server.name,
          page: language.t("settings.tab.projects"),
          server: server.key,
          project: project.worktree,
          view: destination,
        })
        projectSettings.forEach((entry) => {
          if (entry.target === "settings-project-color" && project.icon?.override) return
          add(
            entry,
            { ...destination, tab: entry.tab, target: entry.target, subtab: entry.subtab },
            owner,
            server.key,
            project.worktree,
          )
        })
      })
    })
    return items
  })
  const matches = createMemo(() =>
    rankSettings(
      search.state.query,
      catalog().filter((item) => {
        if (scope() === "all") return true
        if (scope() === "app") return !item.server
        if (scope() === `server:${item.server}`) return true
        return !!item.project && scope() === `project:${item.server}:${item.project}`
      }),
      origin(),
    ),
  )
  const shown = () => matches().slice(0, 60)
  const highlighted = () => shown().find((item) => item.id === state.highlighted) ?? shown()[0]
  const unavailable = () =>
    inventory().filter((server) => !server.connected && (scope() === "all" || scope() === `server:${server.key}`))
  const select = (item: SettingsSearchResult) => surface.search.open(item.view, item.id, `${item.owner} › ${item.page}`)
  const clear = () => {
    search.clear()
    input?.focus()
  }

  return (
    <div class="settings-search" data-expanded={search.state.expanded}>
      <TextInput
        ref={input}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={!!search.state.query.trim() && (!narrow() || search.state.expanded)}
        aria-activedescendant={
          search.state.query.trim() && highlighted() ? `settings-result-${shown().indexOf(highlighted()!)}` : undefined
        }
        value={search.state.query}
        leadingIcon={<Icon name="magnifying-glass" size="small" />}
        placeholder={language.t("settings.search.placeholder")}
        aria-label={language.t("settings.search.placeholder")}
        aria-controls="settings-search-results"
        showClearButton={!!search.state.query}
        onClearClick={clear}
        onFocus={() => search.expand()}
        onInput={(event) => {
          setState("highlighted", "")
          search.input(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && search.state.query) {
            event.preventDefault()
            event.stopPropagation()
            clear()
            return
          }
          if (event.key === "Enter" && highlighted()) {
            event.preventDefault()
            select(highlighted()!)
            return
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
          event.preventDefault()
          const index = shown().findIndex((item) => item.id === highlighted()?.id)
          const next = shown()[Math.max(0, Math.min(shown().length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]
          if (!next) return
          setState("highlighted", next.id)
          results
            ?.querySelector<HTMLElement>(`[data-result-id="${CSS.escape(next.id)}"]`)
            ?.scrollIntoView({ block: "nearest" })
        }}
        spellcheck={false}
        autocomplete="off"
      />
      <Show when={search.state.query.trim()}>
        <div class="settings-search-matches">
          <select
            class="settings-search-scope"
            aria-label={language.t("settings.search.scope.label")}
            value={scope()}
            onChange={(event) => search.scope(event.currentTarget.value)}
          >
            <For each={scopes()}>{(item) => <option value={item.value}>{item.label}</option>}</For>
          </select>
          <div class="settings-search-summary" role="status">
            {language.plural("settings.search.count", matches().length, { count: matches().length })}
          </div>
          <div
            ref={results}
            id="settings-search-results"
            class="settings-search-results"
            role="listbox"
            aria-label={language.t("settings.search.results")}
          >
            <For each={shown()}>
              {(item, index) => (
                <>
                  <Show when={index() === 0 || shown()[index() - 1]?.owner !== item.owner}>
                    <div class="settings-search-group">
                      <bdi dir="auto">{item.owner}</bdi>
                    </div>
                  </Show>
                  <button
                    id={`settings-result-${index()}`}
                    role="option"
                    aria-selected={highlighted()?.id === item.id}
                    aria-label={language.t("settings.search.result", {
                      title: item.title,
                      scope: item.owner,
                      page: item.page,
                    })}
                    type="button"
                    class="settings-search-result"
                    data-result-id={item.id}
                    data-highlighted={highlighted()?.id === item.id}
                    aria-current={search.state.selected === item.id ? "location" : undefined}
                    title={`${item.owner} › ${item.page}${item.description ? `\n${item.description}` : ""}`}
                    onClick={() => select(item)}
                  >
                    <bdi dir="auto" class="settings-search-title">
                      {item.title}
                    </bdi>
                    <span class="settings-search-detail">{item.page}</span>
                    <Show when={item.description}>
                      <bdi dir="auto" class="settings-search-detail settings-search-description">
                        {item.description}
                      </bdi>
                    </Show>
                  </button>
                </>
              )}
            </For>
            <Show when={!matches().length}>
              <div class="settings-search-empty">
                <span>{language.t("settings.search.empty")}</span>
                <span>{language.t("settings.search.hint")}</span>
              </div>
            </Show>
            <Show when={matches().length > shown().length}>
              <p class="settings-search-note">{language.t("settings.search.refine")}</p>
            </Show>
            <For each={unavailable()}>
              {(server) => (
                <p class="settings-search-note">{language.t("settings.search.coverage", { server: server.name })}</p>
              )}
            </For>
            <p class="settings-search-note">{language.t("settings.search.catalogHint")}</p>
          </div>
        </div>
      </Show>
    </div>
  )
}
