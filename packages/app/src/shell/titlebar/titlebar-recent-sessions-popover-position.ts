const POPOVER_WIDTH = 240
const VIEWPORT_GUTTER = 8

export function titlebarRecentSessionsPlacement(input: {
  left: number
  right: number
  viewportWidth: number
  direction: "ltr" | "rtl"
}) {
  const start = input.direction === "rtl" ? input.right - POPOVER_WIDTH : input.left
  const fits = start >= VIEWPORT_GUTTER && start + POPOVER_WIDTH <= input.viewportWidth - VIEWPORT_GUTTER
  return fits ? ("bottom-start" as const) : ("bottom-end" as const)
}
