import { onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"

export function createSizing() {
  const [state, setState] = createStore({ active: false })
  let timer: number | undefined
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    setState("active", false)
  }
  const start = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    setState("active", true)
  }
  onMount(() => {
    makeEventListener(window, "pointerup", stop)
    makeEventListener(window, "pointercancel", stop)
    makeEventListener(window, "blur", stop)
  })
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
  return {
    active: () => state.active,
    start,
    touch() {
      start()
      timer = window.setTimeout(stop, 120)
    },
  }
}
