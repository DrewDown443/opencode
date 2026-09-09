import { Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"

export function SessionHeaderSpacer() {
  const isDesktop = createMediaQuery("(min-width: 768px)")

  return (
    <Show when={isDesktop()}>
      <div class="size-7 shrink-0" aria-hidden />
    </Show>
  )
}
