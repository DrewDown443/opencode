import { describe, expect, test } from "bun:test"
import { rankSettings, type SettingsSearchResult } from "./search-results"

const items: SettingsSearchResult[] = [
  {
    id: "font",
    title: "Terminal font",
    keywords: "typeface",
    description: "",
    owner: "App settings",
    page: "Appearance",
    view: { type: "root", tab: "appearance" },
  },
  {
    id: "local",
    title: "Startup script",
    keywords: "setup command",
    description: "Runs after creating a worktree",
    owner: "Local · Acme",
    page: "General",
    server: "local",
    project: "/acme",
    view: { type: "project", server: "local", project: "/acme", tab: "general", parent: "server" },
  },
  {
    id: "remote",
    title: "Startup script",
    keywords: "setup command",
    description: "Runs after creating a worktree",
    owner: "Remote · Acme",
    page: "General",
    server: "remote",
    project: "/acme",
    view: { type: "project", server: "remote", project: "/acme", tab: "general", parent: "server" },
  },
  {
    id: "project",
    title: "Acme",
    keywords: "",
    description: "/acme",
    owner: "Local",
    page: "Projects",
    server: "local",
    project: "/acme",
    view: { type: "project", server: "local", project: "/acme", tab: "general", parent: "server" },
  },
]

describe("settings search", () => {
  test("exact app setting matches outrank contextual matches in the current project", () => {
    expect(
      rankSettings("terminal font", [...items, { ...items[1], keywords: "terminal font" }], items[1].view).map(
        (item) => item.id,
      ),
    ).toEqual(["font", "local"])
  })

  test("project names alone find the project, while qualified queries find its settings", () => {
    expect(rankSettings("acme", items, items[0].view).map((item) => item.id)).toEqual(["project"])
    expect(rankSettings("remote acme startup", items, items[0].view).map((item) => item.id)).toEqual(["remote"])
  })

  test("equal matches prefer the originating scope without merging servers", () => {
    expect(rankSettings("startup", items, items[2].view).map((item) => item.id)).toEqual(["remote", "local"])
  })

  test("empty and unrelated queries have no results", () => {
    expect(rankSettings("  ", items, items[0].view)).toEqual([])
    expect(rankSettings("zzzzzzzz", items, items[0].view)).toEqual([])
  })
})
