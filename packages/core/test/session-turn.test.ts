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

// Turns are projected, so like the CLI server this runs without durable event persistence.
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, Session.node, LocationServiceMap.node]),
    [Global.node.replace(tempGlobalLayer), SessionExecution.node.replace(SessionExecution.noopLayer), offlineModels],
  ),
)

// Real Location/plugin startup and Git snapshots can exceed five seconds under CI load.
const timeout = 30_000

const initRepo = (directory: string, files: Record<string, string>) =>
  Effect.promise(async () => {
    await fs.mkdir(directory, { recursive: true })
    for (const [name, content] of Object.entries(files)) await Bun.write(path.join(directory, name), content)
    await $`git init -q`.cwd(directory).quiet()
    await $`git -c core.fsmonitor=false add .`.cwd(directory).quiet()
  })

const write = (directory: string, name: string, content: string) => () => Bun.write(path.join(directory, name), content)

/** Unbranded view of a turn for assertions. */
const plain = (turn: Session.Turn) => ({
  ordinal: turn.ordinal,
  status: turn.status,
  first: turn.messages.first,
  last: turn.messages.last,
  directory: String(turn.location.directory),
  files: turn.files.map(String),
  ended: turn.time.ended !== undefined,
})

const summarize = (file: { file: string; status: string; additions: number; deletions: number }) => [
  file.file,
  file.status,
  file.additions,
  file.deletions,
]

/** Publishes the durable events `SessionExecution` and the runner would publish; snapshots come from the provided Location. */
const harness = Effect.fn(function* (sessionID: Session.ID) {
  const session = yield* Session.Service
  const database = yield* Database.Service
  const bus = yield* Bus.Service
  const usage = { cost: Money.USD.zero, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
  const step = Effect.fn(function* (
    edit: () => Promise<unknown>,
    options?: { readonly end?: "running" | "unrecorded" },
  ) {
    const snapshot = yield* Snapshot.Service
    const before = yield* snapshot.capture()
    if (!before) throw new Error("Start snapshot missing")
    const assistantMessageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.defaultID,
      model: { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") },
      snapshot: before,
    })
    yield* Effect.promise(edit)
    if (options?.end === "running") return assistantMessageID
    if (options?.end === "unrecorded") {
      yield* bus.publish(SessionEvent.Step.Ended, { sessionID, assistantMessageID, finish: "stop", ...usage })
      return assistantMessageID
    }
    const after = yield* snapshot.capture()
    if (!after) throw new Error("End snapshot missing")
    yield* bus.publish(SessionEvent.Step.Ended, {
      sessionID,
      assistantMessageID,
      finish: "stop",
      ...usage,
      snapshot: after,
      files: yield* snapshot.files({ from: before, to: after }),
    })
    return assistantMessageID
  })
  return {
    step,
    prompt: Effect.fn(function* (text: string) {
      const admitted = yield* session.prompt({ sessionID, text, resume: false })
      yield* SessionInbox.promote(database.db, bus, sessionID, "steer")
      return admitted.id
    }),
    start: bus.publish(SessionEvent.Execution.Started, { sessionID }),
    succeed: bus.publish(SessionEvent.Execution.Succeeded, { sessionID }),
    fail: bus.publish(SessionEvent.Execution.Failed, { sessionID, error: { type: "unknown", message: "failed" } }),
    interrupt: (reason: "user" | "shutdown") => bus.publish(SessionEvent.Execution.Interrupted, { sessionID, reason }),
    turns: session.turns(sessionID).pipe(Effect.map((turns) => turns.map(plain))),
    diff: (input?: { readonly from?: number; readonly to?: number; readonly context?: number }) =>
      session.diff({ sessionID, ...input }),
    summary: (input?: { readonly from?: number; readonly to?: number }) =>
      session.diff({ sessionID, ...input, context: 0 }).pipe(Effect.map((files) => files.map(summarize))),
  }
})

describe("Session turns", () => {
  it.live(
    "lists busy periods as turns and diffs contiguous ranges of them",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        yield* initRepo(directory, { "first.txt": "first\n", "second.txt": "second\n", "manual.txt": "manual\n" })
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        expect(yield* sessions.turns(created.id)).toEqual([])
        expect(yield* sessions.diff({ sessionID: created.id })).toEqual([])

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const t = yield* harness(created.id)

          yield* t.start
          const first = yield* t.prompt("Edit the first file")
          yield* t.step(write(directory, "first.txt", "first edited\n"))
          yield* t.succeed

          // Edits between turns are not attributed to a turn's files, but a range diff still sees them.
          yield* Effect.promise(write(directory, "manual.txt", "manual edited\n"))

          yield* t.start
          const second = yield* t.prompt("Edit the second file")
          const secondStep = yield* t.step(write(directory, "second.txt", "second edited\n"))
          // A steer delivered while busy stays inside the turn.
          const steer = yield* t.prompt("Also add a third file")
          const third = yield* t.step(write(directory, "third.txt", "third\n"))
          yield* t.fail

          // A wake that produces no step is not a turn.
          yield* t.start
          yield* t.succeed

          // Shutdown keeps the execution claim, so the resumed drain continues the same turn.
          yield* t.start
          const fourth = yield* t.prompt("Rename the third file")
          yield* t.step(() => fs.rm(path.join(directory, "third.txt")))
          yield* t.interrupt("shutdown")
          yield* t.start
          yield* t.step(write(directory, "renamed.txt", "third\n"))
          yield* t.interrupt("user")

          const turns = yield* t.turns
          expect(turns.map((turn) => [turn.ordinal, turn.status, turn.first, turn.files, turn.ended])).toEqual([
            [1, "succeeded", first, ["first.txt"], true],
            [2, "failed", second, ["second.txt", "third.txt"], true],
            [3, "interrupted", fourth, ["third.txt", "renamed.txt"], true],
          ])
          expect(turns[1]?.last).toBe(third)
          expect(turns.every((turn) => turn.directory === directory)).toBe(true)

          expect(yield* t.summary()).toEqual([
            ["renamed.txt", "added", 1, 0],
            ["third.txt", "deleted", 0, 1],
          ])
          expect(yield* t.summary({ from: 2, to: 2 })).toEqual([
            ["second.txt", "modified", 1, 1],
            ["third.txt", "added", 1, 0],
          ])
          expect(yield* t.summary({ to: 2 })).toEqual([
            ["first.txt", "modified", 1, 1],
            ["manual.txt", "modified", 1, 1],
            ["second.txt", "modified", 1, 1],
            ["third.txt", "added", 1, 0],
          ])
          expect(yield* t.summary({ from: 2 })).toEqual([
            ["renamed.txt", "added", 1, 0],
            ["second.txt", "modified", 1, 1],
          ])
          const full = yield* t.diff({ from: 1, to: 1 })
          expect(full[0]?.patch).toContain("-first\n+first edited\n")

          const backwards = yield* t.diff({ from: 3, to: 2 }).pipe(Effect.flip)
          expect(backwards).toMatchObject({ _tag: "Session.TurnRangeError", field: "from" })
          expect(yield* t.diff({ from: 4 }).pipe(Effect.flip)).toMatchObject({ field: "from" })
          expect(yield* t.diff({ to: 4 }).pipe(Effect.flip)).toMatchObject({ field: "to" })

          // A completed step without an end snapshot falls back to the last recorded end.
          yield* t.start
          yield* t.prompt("Edit the first file again")
          yield* t.step(write(directory, "first.txt", "first edited twice\n"))
          yield* t.step(write(directory, "second.txt", "second edited twice\n"), { end: "unrecorded" })
          yield* t.succeed
          expect(yield* t.summary()).toEqual([["first.txt", "modified", 1, 1]])

          // A running last step compares against the working copy.
          yield* t.start
          yield* t.prompt("Delete the manual file")
          yield* t.step(() => fs.rm(path.join(directory, "manual.txt")), { end: "running" })
          expect((yield* t.turns).at(-1)).toMatchObject({ ordinal: 5, status: "running", ended: false })
          expect(yield* t.summary()).toEqual([["manual.txt", "deleted", 0, 1]])
          yield* t.succeed

          // Reverting truncates history: later turns disappear with their steps and a straddling turn shrinks.
          yield* sessions.revert.stage({ sessionID: created.id, messageID: steer, files: false })
          yield* sessions.revert.commit(created.id)
          const reverted = yield* t.turns
          expect(reverted.map((turn) => [turn.ordinal, turn.status, turn.files, turn.last])).toEqual([
            [1, "succeeded", ["first.txt"], turns[0]?.last],
            [2, "failed", ["second.txt"], secondStep],
          ])
          expect(yield* t.summary()).toEqual([["second.txt", "modified", 1, 1]])
          expect(yield* t.diff({ from: 3 }).pipe(Effect.flip)).toMatchObject({ field: "from" })

          // The next busy period starts a fresh turn after the truncated one.
          yield* t.start
          const resumed = yield* t.prompt("Start over")
          yield* t.step(write(directory, "third.txt", "third again\n"))
          yield* t.succeed
          expect((yield* t.turns).map((turn) => [turn.ordinal, turn.first, turn.files])).toEqual([
            [1, first, ["first.txt"]],
            [2, second, ["second.txt"]],
            [3, resumed, ["third.txt"]],
          ])
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    { timeout },
  )

  it.live(
    "forks inherit the turns of their copied history",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        yield* initRepo(directory, { "first.txt": "first\n", "second.txt": "second\n" })
        const sessions = yield* Session.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const turnsOf = (sessionID: Session.ID) =>
          sessions.turns(sessionID).pipe(Effect.map((turns) => turns.map(plain)))

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const parent = yield* harness(created.id)
          yield* parent.start
          yield* parent.prompt("Edit the first file")
          yield* parent.step(write(directory, "first.txt", "first edited\n"))
          yield* parent.succeed
          yield* parent.start
          const second = yield* parent.prompt("Edit the second file")
          yield* parent.step(write(directory, "second.txt", "second edited\n"))
          yield* parent.succeed

          const forked = yield* sessions.fork({
            sessionID: created.id,
            boundary: { type: "before", messageID: second },
          })
          const child = yield* harness(forked.id)
          const inherited = yield* child.turns
          expect(inherited.map((turn) => [turn.ordinal, turn.status, turn.files])).toEqual([
            [1, "succeeded", ["first.txt"]],
          ])
          const messages = yield* sessions.messages({ sessionID: forked.id, order: "asc" })
          expect(inherited[0]).toMatchObject({ first: messages[0]?.id, last: messages.at(-1)?.id })

          yield* child.start
          const own = yield* child.prompt("Add a third file")
          yield* child.step(write(directory, "third.txt", "third\n"))
          yield* child.succeed
          expect((yield* child.turns).map((turn) => [turn.ordinal, turn.first, turn.files])).toEqual([
            [1, messages[0]?.id, ["first.txt"]],
            [2, own, ["third.txt"]],
          ])
          expect(yield* child.summary({ from: 1 })).toEqual([
            ["first.txt", "modified", 1, 1],
            ["second.txt", "modified", 1, 1],
            ["third.txt", "added", 1, 0],
          ])
          expect(yield* child.summary({ to: 1 })).toEqual([["first.txt", "modified", 1, 1]])

          const grandchild = yield* sessions.fork({ sessionID: forked.id, boundary: { type: "through" } })
          expect((yield* turnsOf(grandchild.id)).map((turn) => [turn.ordinal, turn.files])).toEqual([
            [1, ["first.txt"]],
            [2, ["third.txt"]],
          ])

          // Forking mid-turn cuts the copied turn at the boundary; the parent's turn keeps running.
          yield* parent.start
          yield* parent.prompt("Edit both files")
          yield* parent.step(write(directory, "first.txt", "first edited twice\n"))
          const cut = yield* sessions.fork({ sessionID: created.id, boundary: { type: "through" } })
          expect((yield* turnsOf(cut.id)).map((turn) => [turn.ordinal, turn.status, turn.files, turn.ended])).toEqual([
            [1, "succeeded", ["first.txt"], true],
            [2, "succeeded", ["second.txt"], true],
            [3, "interrupted", ["first.txt"], true],
          ])
          const cutDiff = yield* sessions.diff({ sessionID: cut.id, context: 0 })
          expect(cutDiff.map(summarize)).toEqual([["first.txt", "modified", 1, 1]])
          yield* parent.step(write(directory, "second.txt", "second edited twice\n"))
          yield* parent.succeed
          expect((yield* parent.turns).at(-1)).toMatchObject({
            ordinal: 3,
            status: "succeeded",
            files: ["first.txt", "second.txt"],
          })
          expect((yield* turnsOf(cut.id)).at(-1)).toMatchObject({
            ordinal: 3,
            status: "interrupted",
            files: ["first.txt"],
          })
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
      }),
    { timeout },
  )

  it.live(
    "attributes turns to the location of their first step and refuses to diff across a move",
    () =>
      Effect.gen(function* () {
        const tmp = yield* tmpdirScoped()
        const directory = path.join(tmp.path, "project")
        const destination = path.join(tmp.path, "elsewhere")
        yield* initRepo(directory, { "first.txt": "first\n" })
        yield* initRepo(destination, { "other.txt": "other\n" })
        const sessions = yield* Session.Service
        const bus = yield* Bus.Service
        const created = yield* sessions.create({ location: { directory: AbsolutePath.make(directory) } })
        const moved = { directory: AbsolutePath.make(destination) }
        const move = bus.publish(SessionEvent.Moved, {
          sessionID: created.id,
          location: moved,
          projectID: created.projectID,
        })
        const t = yield* harness(created.id)

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          yield* t.start
          yield* t.prompt("Edit the first file")
          yield* t.step(write(directory, "first.txt", "first edited\n"))
          yield* t.succeed

          // The move lands at a step boundary, so the turn straddles two locations.
          yield* t.start
          yield* t.prompt("Edit the first file, then continue elsewhere")
          yield* t.step(write(directory, "first.txt", "first edited twice\n"))
        }).pipe(Effect.provide(LocationServiceMap.Service.get(created.location)))
        yield* move
        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          yield* t.step(write(destination, "other.txt", "other edited\n"))
          yield* t.succeed

          yield* t.start
          yield* t.prompt("Add a file elsewhere")
          yield* t.step(write(destination, "added.txt", "added\n"))
          yield* t.succeed
        }).pipe(Effect.provide(LocationServiceMap.Service.get(moved)))

        expect((yield* t.turns).map((turn) => [turn.ordinal, turn.directory])).toEqual([
          [1, directory],
          [2, directory],
          [3, destination],
        ])
        expect(yield* t.summary({ from: 1, to: 1 })).toEqual([["first.txt", "modified", 1, 1]])
        expect(yield* t.summary({ from: 3 })).toEqual([["added.txt", "added", 1, 0]])
        expect(yield* t.diff({ from: 2, to: 2 }).pipe(Effect.flip)).toMatchObject({
          _tag: "Session.TurnRangeError",
          message: "Turn range spans a location change",
        })
        expect(yield* t.diff({ from: 1, to: 3 }).pipe(Effect.flip)).toMatchObject({ _tag: "Session.TurnRangeError" })
      }),
    { timeout },
  )

  it.live("fails for an unknown session", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const unknown = Session.ID.create()
      expect(yield* sessions.turns(unknown).pipe(Effect.flip)).toMatchObject({ _tag: "Session.NotFoundError" })
      expect(yield* sessions.diff({ sessionID: unknown }).pipe(Effect.flip)).toMatchObject({
        _tag: "Session.NotFoundError",
      })
    }),
  )
})
