import fuzzysort from "fuzzysort"
import type { SettingsView } from "./surface"

export type SettingsSearchResult = {
  id: string
  title: string
  keywords: string
  description: string
  owner: string
  page: string
  server?: string
  project?: string
  view: SettingsView
}

export function rankSettings(query: string, items: SettingsSearchResult[], origin: SettingsView) {
  const value = query.trim().toLowerCase()
  if (!value) return []
  const tokens = value.split(/\s+/)
  return items
    .flatMap((item) => {
      const title = item.title.toLowerCase()
      const primary = `${title} ${item.keywords}`.toLowerCase()
      const description = item.description.toLowerCase()
      const context = `${item.owner} ${item.page}`.toLowerCase()
      // Context qualifies a setting match; a project name alone should not return all its controls.
      if (
        !tokens.some((token) => `${primary} ${description}`.includes(token)) &&
        (fuzzysort.single(value, title)?.score ?? 0) < 0.6
      )
        return []
      const score =
        title === value
          ? 5
          : tokens.every((token) => title.includes(token))
            ? 4
            : tokens.every((token) => primary.includes(token))
              ? 3
              : tokens.every((token) => `${primary} ${description} ${context}`.includes(token))
                ? 2
                : (fuzzysort.single(value, title)?.score ?? 0) >= 0.6
                  ? 1
                  : 0
      if (!score) return []
      const proximity =
        origin.type === "project" && origin.server === item.server && origin.project === item.project
          ? 2
          : origin.type !== "root" && origin.server === item.server
            ? 1
            : 0
      return [{ item, score, proximity }]
    })
    .sort((a, b) => b.score - a.score || b.proximity - a.proximity || a.item.title.localeCompare(b.item.title))
    .map((result) => result.item)
}
