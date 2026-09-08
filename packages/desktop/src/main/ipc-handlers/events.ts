import { BrowserWindow } from "electron"
import { Effect } from "effect"
import { EventRpcs } from "../../shared/ipc-rpc"
import { createBrowserPane } from "../browser-pane"
import { ipcEventStream } from "../ipc-events"
import { IpcPortHandoff } from "../ipc-transport"
import { Shutdown } from "../lifecycle/shutdown"
import { isRendererUrl } from "../windows/protocol"
import { sender } from "./context"
import { createMainExtensionHost } from "../extensions/host"
import { mainExtensions } from "../extensions/builtins"
import { emitIpcEvent } from "../ipc-events"
import { ExtensionEvent } from "../../shared/ipc-rpc/events"

export const eventHandlers = EventRpcs.toLayer(
  Effect.gen(function* () {
    const handoff = yield* IpcPortHandoff
    const shutdown = yield* Shutdown.Service
    const browser = createBrowserPane()
    const extensions = createMainExtensionHost(mainExtensions, (win, event) =>
      emitIpcEvent(win.webContents, new ExtensionEvent({ event })),
    )
    yield* Effect.addFinalizer(() => Effect.promise(() => extensions.dispose()))
    const stop = Effect.promise(() => browser.dispose())
    const remove = yield* shutdown.add(stop)
    yield* Effect.addFinalizer(() => Effect.sync(remove).pipe(Effect.andThen(stop)))
    return EventRpcs.of({
      DesktopExtension: ({ request }, context) =>
        Effect.tryPromise(async () => {
          const contents = sender(handoff, context)
          const win = BrowserWindow.fromWebContents(contents)
          if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL()))
            throw new Error("Desktop extension owner is unavailable")
          if (request.type === "call") return extensions.call(win, request.call)
          if (request.type === "cancel") extensions.cancel(win, request.extensionID, request.requestID)
          if (request.type === "servers") extensions.configure(win, request.servers)
          if (request.type === "surface")
            extensions.surface(win, request.extensionID, request.surfaceID, request.layout)
          if (request.type === "release") extensions.release(win, request.extensionID)
          return null
        }).pipe(Effect.orDie),
      DesktopEvents: (_request, context) => ipcEventStream(sender(handoff, context).id),
      BrowserPane: ({ request }, context) =>
        Effect.tryPromise(async () => {
          const contents = sender(handoff, context)
          const win = BrowserWindow.fromWebContents(contents)
          if (!win || win.isDestroyed() || win.webContents !== contents || !isRendererUrl(contents.getURL())) {
            throw new Error("browser.pane.owner.invalid")
          }
          if (request.type === "register") return browser.register(win, request.bindingID, request.target)
          if (request.type === "layout") return browser.layout(win, request.bindingID, request.layout)
          if (request.type === "command") return browser.command(win, request.bindingID, request.command)
          return browser.close(win, request.bindingID)
        }).pipe(Effect.orDie),
    })
  }),
)
