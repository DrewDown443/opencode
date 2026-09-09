import { useLocation, useNavigate } from "@solidjs/router"
import { createEffect, on } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "@opencode/ui/context"
import { useLayout, type LayoutRoute } from "@/shell/state/layout"
import { useCommand } from "@/shell/commands/command"
import { useSettingsServers } from "./servers/inventory"

export type SettingsRootTab =
  | "general"
  | "appearance"
  | "notifications"
  | "shortcuts"
  | "projects"
  | "workspaces"
  | "providers"
  | "models"
  | "extensions"
  | "servers"
  | "experimental"
  | "about"

export type SettingsServerTab = "general" | "projects" | "workspaces" | "providers" | "models" | "extensions"
export type SettingsProjectTab = "general" | "workspaces" | "extensions"

export type SettingsView = (
  | { type: "root"; tab: SettingsRootTab }
  | { type: "server"; server: string; tab: SettingsServerTab }
  | {
      type: "project"
      server: string
      project: string
      tab: SettingsProjectTab
      parent: "root" | "server"
    }
) & { target?: string; subtab?: "mcps" | "plugins" | "skills" | "lsps" }

const rootTabs: Record<SettingsRootTab, true> = {
  general: true,
  appearance: true,
  notifications: true,
  shortcuts: true,
  projects: true,
  workspaces: true,
  providers: true,
  models: true,
  extensions: true,
  servers: true,
  experimental: true,
  about: true,
}
const serverTabs: Record<SettingsServerTab, true> = {
  general: true,
  projects: true,
  workspaces: true,
  providers: true,
  models: true,
  extensions: true,
}
const projectTabs: Record<SettingsProjectTab, true> = {
  general: true,
  workspaces: true,
  extensions: true,
}

function isRootTab(value: string): value is SettingsRootTab {
  return value in rootTabs
}

function isServerTab(value: string): value is SettingsServerTab {
  return value in serverTabs
}

function isProjectTab(value: string): value is SettingsProjectTab {
  return value in projectTabs
}

export const { use: useSettingsSurface, provider: SettingsSurfaceProvider } = createSimpleContext({
  name: "SettingsSurface",
  gate: false,
  init: () => {
    const navigate = useNavigate()
    const layout = useLayout()
    const command = useCommand()
    const servers = useSettingsServers()
    const location = useLocation<{
      settings?: { route: Exclude<LayoutRoute, { type: "settings" }>; view: SettingsView }
    }>()
    const open = () => layout.route().type === "settings"
    const source = () => location.state?.settings?.route ?? { type: "home" as const }
    const view = (): SettingsView => location.state?.settings?.view ?? { type: "root", tab: "general" }
    const [search, setSearch] = createStore({
      query: "",
      scope: "all",
      origin: undefined as SettingsView | undefined,
      selected: "",
      breadcrumb: "",
      expanded: true,
    })
    let focus: HTMLElement | undefined

    const show = (view: SettingsView, replace: boolean) => {
      const route = layout.route()
      if (route.type !== "settings" && document.activeElement instanceof HTMLElement) focus = document.activeElement
      navigate("/settings", {
        replace,
        state: { settings: { route: route.type === "settings" ? source() : route, view } },
      })
    }

    createEffect(
      on(
        open,
        (value) => {
          if (value) return
          setSearch({ query: "", scope: "all", origin: undefined, selected: "", breadcrumb: "", expanded: true })
          if (focus?.isConnected) focus.focus({ preventScroll: true })
          focus = undefined
        },
        { defer: true },
      ),
    )

    return {
      active: open,
      route: source,
      view,
      search: {
        state: search,
        input(query: string) {
          if (!search.query.trim() && query.trim()) setSearch("origin", { ...view(), target: undefined })
          setSearch({ query, expanded: true })
          if (!query.trim()) setSearch({ selected: "", breadcrumb: "", origin: undefined })
        },
        scope(scope: string) {
          setSearch({ scope, expanded: true })
        },
        expand() {
          setSearch("expanded", true)
        },
        open(destination: SettingsView, id: string, breadcrumb: string) {
          setSearch({ selected: id, breadcrumb, expanded: false })
          show(destination, true)
        },
        clear() {
          setSearch({ query: "", selected: "", breadcrumb: "", origin: undefined, expanded: true })
        },
        back() {
          if (!search.query.trim() || !search.selected) return false
          if (search.selected && search.origin) {
            show(search.origin, true)
            setSearch({ selected: "", breadcrumb: "", expanded: true })
            return true
          }
          return false
        },
      },
      open(tab: SettingsRootTab = "general") {
        show({ type: "root", tab }, open())
      },
      openServer(server: string, tab: SettingsServerTab = "general") {
        show({ type: "server", server, tab }, false)
      },
      replaceServer(server: string, tab: SettingsServerTab = "general") {
        show({ type: "server", server, tab }, true)
      },
      openProject(input: { server: string; project: string; tab?: SettingsProjectTab }) {
        show(
          {
            type: "project",
            ...input,
            parent: servers().length > 1 ? "server" : "root",
            tab: input.tab ?? "general",
          },
          false,
        )
      },
      select(tab: string) {
        const current = view()
        const next: SettingsView =
          current.type === "root" && isRootTab(tab)
            ? { ...current, tab }
            : current.type === "server" && isServerTab(tab)
              ? { ...current, tab }
              : current.type === "project" && isProjectTab(tab)
                ? { ...current, tab }
                : current
        show({ ...next, target: undefined, subtab: undefined }, true)
      },
      subtab(subtab: SettingsView["subtab"]) {
        show({ ...view(), subtab, target: undefined }, true)
      },
      back() {
        const current = view()
        if (current.type === "root") {
          command.trigger("common.goBack")
          return
        }
        const parent: SettingsView =
          current.type === "server" || current.parent === "root"
            ? { type: "root", tab: current.type === "server" ? "general" : "projects" }
            : { type: "server", server: current.server, tab: "projects" }
        show(parent, true)
      },
      close() {
        if (open()) command.trigger("common.goBack")
      },
    }
  },
})
