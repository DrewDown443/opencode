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
import { SessionDiff } from "@opencode-ai/core/session/diff"
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
    [Global.node.replace(tempGlobalLayer), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)

const summarize = (file: { file: string; status: string; additions: number; deletions: number }) => [
  file.file,
  file.status,
  file.additions,
  file.deletions,
]

describe("Session.diff", () => {
  it.live(
    "diffs the steps that follow a user message and ranges across later turns",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const write = (name: string, content: string) => () => Bun.write(path.join(directory, name), content)
        yield* Effect.promise(async () => {
          await fs.mkdir(directory)
          await write("first.txt", "first\n")()
          await write("second.txt", "second\n")()
          await write("manual.txt", "manual\n")()
          await $`git init -q`.cwd(directory).quiet()
          await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
        })
        const sessions = yield* Session.Service
        const database = yield* Database.Service
        const bus = yield* Bus.Service
        const locations = yield* LocationServiceMap.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const diff = (input?: { messageID?: SessionMessage.ID; to?: SessionMessage.ID }) =>
          sessions
            .diff({ sessionID: created.id, context: 0, ...input })
            .pipe(Effect.map((files) => files.map(summarize)))
        expect(yield* diff()).toEqual([])

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const snapshot = yield* Snapshot.Service
          const usage = {
            cost: Money.USD.zero,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
          const prompt = Effect.fn(function* (text: string) {
            const admitted = yield* sessions.prompt({ sessionID: created.id, text, resume: false })
            yield* SessionInbox.promote(database.db, bus, created.id, "steer")
            return admitted.id
          })
          const step = Effect.fn(function* (edit: () => Promise<unknown>, end: "recorded" | "unrecorded" | "running") {
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
            if (end === "running") return assistantMessageID
            const after = end === "recorded" ? yield* snapshot.capture() : undefined
            yield* bus.publish(SessionEvent.Step.Ended, {
              sessionID: created.id,
              assistantMessageID,
              finish: "stop",
              ...usage,
              snapshot: after,
              files: after && before ? yield* snapshot.files({ from: before, to: after }) : undefined,
            })
            return assistantMessageID
          })

          const first = yield* prompt("Edit the first file")
          const firstStep = yield* step(write("first.txt", "first edited\n"), "recorded")
          // Edits made while idle are not a turn's work, but a range spanning them still sees them.
          yield* Effect.promise(write("manual.txt", "manual edited\n"))
          const second = yield* prompt("Edit the second file")
          yield* step(write("second.txt", "second edited\n"), "recorded")
          // A steer is a new prompt, so it starts a new turn.
          const steer = yield* prompt("Also add a third file")
          yield* step(write("third.txt", "third\n"), "recorded")

          expect(yield* diff()).toEqual([["third.txt", "added", 1, 0]])
          expect(yield* diff({ messageID: second })).toEqual([["second.txt", "modified", 1, 1]])
          expect(yield* diff({ messageID: second, to: steer })).toEqual([
            ["second.txt", "modified", 1, 1],
            ["third.txt", "added", 1, 0],
          ])
          expect(yield* diff({ messageID: first, to: steer })).toEqual([
            ["first.txt", "modified", 1, 1],
            ["manual.txt", "modified", 1, 1],
            ["second.txt", "modified", 1, 1],
            ["third.txt", "added", 1, 0],
          ])
          const full = yield* sessions.diff({ sessionID: created.id, messageID: first })
          expect(full[0]?.patch).toContain("-first\n+first edited\n")
          expect(yield* diff({ messageID: steer, to: second }).pipe(Effect.flip)).toMatchObject({
            _tag: "Session.TurnRangeError",
            field: "to",
          })
          expect(yield* diff({ messageID: firstStep }).pipe(Effect.flip)).toMatchObject({
            _tag: "Session.TurnRangeError",
            field: "messageID",
          })
          expect(yield* diff({ messageID: SessionMessage.ID.create() }).pipe(Effect.flip)).toMatchObject({
            _tag: "Session.MessageNotFoundError",
          })

          // A completed step without an end snapshot falls back to the last recorded end.
          yield* prompt("Edit both files again")
          yield* step(write("first.txt", "first edited twice\n"), "recorded")
          yield* step(write("second.txt", "second edited twice\n"), "unrecorded")
          expect(yield* diff()).toEqual([["first.txt", "modified", 1, 1]])

          // Only a step still running in the active session compares against the working copy.
          yield* prompt("Delete the manual file")
          yield* step(() => fs.rm(path.join(directory, "manual.txt")), "running")
          expect(yield* diff()).toEqual([])
          const session = yield* sessions.get(created.id)
          const live = yield* SessionDiff.turn(database.db, locations, { session, active: true, context: 0 })
          expect(live.map(summarize)).toEqual([["manual.txt", "deleted", 0, 1]])

          // Reverting removes later turns; a fork keeps the copied ones.
          yield* sessions.revert.stage({ sessionID: created.id, messageID: steer, files: false })
          yield* sessions.revert.commit(created.id)
          expect(yield* diff()).toEqual([["second.txt", "modified", 1, 1]])
          expect(yield* diff({ messageID: steer }).pipe(Effect.flip)).toMatchObject({
            _tag: "Session.MessageNotFoundError",
          })
          const forked = yield* sessions.fork({ sessionID: created.id, boundary: { type: "through" } })
          expect((yield* sessions.diff({ sessionID: forked.id, context: 0 })).map(summarize)).toEqual([
            ["second.txt", "modified", 1, 1],
          ])
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    // Real Location/plugin startup and Git snapshots can exceed five seconds under CI load.
    { timeout: 30_000 },
  )
})
