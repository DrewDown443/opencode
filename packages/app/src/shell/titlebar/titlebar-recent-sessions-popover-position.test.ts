import { describe, expect, test } from "bun:test"
import { titlebarRecentSessionsPlacement } from "./titlebar-recent-sessions-popover-position"

describe("titlebar recent sessions placement", () => {
  test("attaches to the start while the popover fits", () => {
    expect(titlebarRecentSessionsPlacement({ left: 100, right: 128, viewportWidth: 800, direction: "ltr" })).toBe(
      "bottom-start",
    )
  })

  test("attaches to the end near the right edge", () => {
    expect(titlebarRecentSessionsPlacement({ left: 570, right: 598, viewportWidth: 600, direction: "ltr" })).toBe(
      "bottom-end",
    )
  })

  test("uses the mirrored start edge in RTL", () => {
    expect(titlebarRecentSessionsPlacement({ left: 4, right: 32, viewportWidth: 600, direction: "rtl" })).toBe(
      "bottom-end",
    )
    expect(titlebarRecentSessionsPlacement({ left: 300, right: 328, viewportWidth: 600, direction: "rtl" })).toBe(
      "bottom-start",
    )
  })
})
