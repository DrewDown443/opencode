import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/OpenCode/RecentSessions"
const longTitle = "A deliberately long recent session title that must truncate inside the compact titlebar popover"
const sessions = [
  session("ses_search_target", "Hidden search target", 1),
  session("ses_2", "Recent session 2", 2),
  session("ses_3", "Recent session 3", 3),
  session("ses_4", "Recent session 4", 4),
  session("ses_5", "Recent session 5", 5),
  session("ses_6", "Recent session 6", 6),
  session("ses_7", longTitle, 7),
]

test("opens and searches recent sessions from the new-session button", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_recent_sessions",
      worktree: directory,
      vcs: "git",
      name: "RecentSessions",
      time: { created: 1, updated: 1 },
      sandboxes: [],
    },
    provider: { all: [], connected: [], default: null },
    sessions: [...sessions],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
        recentlyClosed: { local: [] },
      }),
    )
  }, directory)

  await page.goto("/")
  const newSession = page.locator('[data-action="titlebar-new-session"]')
  await expect(newSession).toBeVisible()
  await newSession.click({ button: "right" })

  const popover = page.getByRole("dialog", { name: "Recent sessions" })
  const search = popover.getByRole("combobox", { name: "Search sessions" })
  const options = popover.getByRole("option")
  await expect(popover).toBeVisible()
  await expect(newSession).toHaveAttribute("data-state", "pressed")
  await expect(popover).toHaveCSS("width", "240px")
  await expect(search).toBeFocused()
  await expect(options).toHaveCount(5)
  await expect
    .poll(() => options.evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))))
    .toEqual([longTitle, "Recent session 6", "Recent session 5", "Recent session 4", "Recent session 3"])
  await expect(popover.getByRole("option", { name: longTitle })).toHaveAttribute("aria-selected", "true")

  const title = popover.locator('[data-slot="titlebar-recent-session-title"]').filter({ hasText: longTitle })
  await expect(title).toHaveCSS("text-overflow", "ellipsis")
  await expect.poll(() => title.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

  await search.press("Escape")
  await expect(popover).toBeHidden()
  await expect(newSession).not.toHaveAttribute("data-state")
  await expect(newSession).toBeFocused()
  await newSession.click({ button: "right" })
  await expect(search).toBeFocused()

  await search.fill("hidden search")
  await expect(options).toHaveCount(1)
  await expect(popover.getByRole("option", { name: "Hidden search target" })).toHaveAttribute("aria-selected", "true")

  await search.fill("")
  await expect(options).toHaveCount(5)
  await search.press("ArrowDown")
  await expect(popover.getByRole("option", { name: "Recent session 6" })).toHaveAttribute("aria-selected", "true")
  await search.press("Enter")
  await expect(page).toHaveURL(/\/session\/ses_6$/)
  await expect(popover).toBeHidden()

  await newSession.click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(popover).toBeHidden()
})

function session(id: string, title: string, updated: number) {
  return {
    id,
    projectID: "proj_recent_sessions",
    title,
    location: { directory },
    time: { created: updated, updated },
  }
}
