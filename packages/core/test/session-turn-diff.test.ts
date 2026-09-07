import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Model } from "@opencode-ai/core/model"
import { Plugin } from "@opencode-ai/core/plugin"
import { Provider } from "@opencode-ai/core/provider"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionInbox } from "@opencode-ai/core/session/inbox"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Snapshot } from "@opencode-ai/core/snapshot"
import { Money } from "@opencode-ai/schema/money"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Global } from "@opencode-ai/util/global"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)

describe("Session.turnDiff", () => {
  it.live(
    "diffs only the newest turn and ignores edits made after its last step",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        yield* Effect.promise(async () => {
          await fs.mkdir(directory)
          await Bun.write(path.join(directory, "first.txt"), "first\n")
          await Bun.write(path.join(directory, "second.txt"), "second\n")
          await Bun.write(path.join(directory, "manual.txt"), "manual\n")
          await $`git init -q`.cwd(directory).quiet()
          await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
        })

        const session = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const created = yield* session.create({ location: { directory: AbsolutePath.make(directory) } })
        expect(yield* session.turnDiff({ sessionID: created.id })).toEqual([])

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const snapshot = yield* Snapshot.Service
          const step = Effect.fn(function* (edit: () => Promise<unknown>, options?: { readonly end?: false }) {
            const before = yield* snapshot.capture()
            if (!before) throw new Error("Start snapshot missing")
            const assistantMessageID = SessionMessage.ID.create()
            yield* bus.publish(SessionEvent.Step.Started, {
              sessionID: created.id,
              assistantMessageID,
              agent: Agent.defaultID,
              model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
              snapshot: before,
            })
            yield* Effect.promise(edit)
            if (options?.end === false) return
            const after = yield* snapshot.capture()
            if (!after) throw new Error("End snapshot missing")
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: created.id,
              assistantMessageID,
              finish: "stop",
              cost: Money.USD.zero,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              snapshot: after,
              files: yield* snapshot.files({ from: before, to: after }),
            })
          })
          const turn = Effect.fn(function* (text: string) {
            yield* session.prompt({ sessionID: created.id, text, resume: false })
            yield* SessionInbox.promote(database.db, bus, created.id, "steer")
          })

          yield* turn("Edit the first file")
          yield* step(() => Bun.write(path.join(directory, "first.txt"), "first edited\n"))
          yield* step(() => Bun.write(path.join(directory, "second.txt"), "second edited\n"))
          yield* Effect.promise(() => Bun.write(path.join(directory, "manual.txt"), "manual edited\n"))
          const first = yield* session.turnDiff({ sessionID: created.id, context: 0 })
          expect(first.map((file) => [file.file, file.status, file.additions, file.deletions])).toEqual([
            ["first.txt", "modified", 1, 1],
            ["second.txt", "modified", 1, 1],
          ])
          expect(first[0]?.patch).toContain("-first\n+first edited\n")

          yield* turn("Now add a third file")
          yield* step(() => Bun.write(path.join(directory, "third.txt"), "third\n"))
          expect((yield* session.turnDiff({ sessionID: created.id })).map((file) => [file.file, file.status])).toEqual([
            ["third.txt", "added"],
          ])

          yield* turn("Delete the second file while the step is still running")
          yield* step(() => fs.rm(path.join(directory, "second.txt")), { end: false })
          expect((yield* session.turnDiff({ sessionID: created.id })).map((file) => [file.file, file.status])).toEqual([
            ["second.txt", "deleted"],
          ])
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    // Real Location/plugin startup and Git snapshots can exceed five seconds under CI load.
    { timeout: 15_000 },
  )

  it.live("fails for an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const result = yield* session.turnDiff({ sessionID: Session.ID.create() }).pipe(Effect.flip)
      expect(result._tag).toBe("Session.NotFoundError")
    }),
  )
})
