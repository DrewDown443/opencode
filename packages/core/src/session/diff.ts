export * as SessionDiff from "./diff.js"

import { and, asc, eq, gt, lt, or, sql } from "drizzle-orm"
import { Context, Effect, Schema } from "effect"
import { Location } from "@opencode-ai/schema/location"
import { Database } from "../database/database.js"
import { LocationServiceMap } from "../location-service-map.js"
import { Snapshot } from "../snapshot.js"
import { PATCH_CONTEXT_LINES } from "../vcs/patch.js"
import { MessageNotFoundError } from "./error.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionMessageTable } from "./sql.js"

export class TurnRangeError extends Schema.TaggedError<TurnRangeError>()("Session.TurnRangeError", {
  sessionID: SessionSchema.ID,
  field: Schema.Literals(["messageID", "to"]),
  message: Schema.String,
}) {}

const decodeLocation = Schema.decodeUnknownSync(Schema.fromJsonString(Location.Ref))

/**
 * Diff the files changed by a turn: the steps that follow a user message up to
 * the next user message, so a steer starts its own turn. `to` extends the range
 * through a later user message's turn. Compares the range's first recorded
 * start snapshot with its last recorded end snapshot; only a step still running
 * in the active Session compares against the working copy. Like VCS diffs, an
 * omitted `context` yields full-file patches.
 *
 * Snapshot trees live in the repository of the Location that captured them, so a
 * range spanning a location switch is rejected rather than diffed wrongly.
 */
export const turn = Effect.fn("SessionDiff.turn")(function* (
  db: Database.Interface["db"],
  locations: Context.Service.Shape<typeof LocationServiceMap.Service>,
  input: {
    readonly session: SessionSchema.Info
    /** The process is currently executing this Session. */
    readonly active: boolean
    readonly messageID?: SessionMessage.ID
    readonly to?: SessionMessage.ID
    readonly context?: number
  },
) {
  const sessionID = input.session.id
  const users = yield* db
    .select({ id: SessionMessageTable.id, type: SessionMessageTable.type, seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        or(
          eq(SessionMessageTable.type, "user"),
          input.messageID ? eq(SessionMessageTable.id, input.messageID) : undefined,
          input.to ? eq(SessionMessageTable.id, input.to) : undefined,
        ),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const resolve = Effect.fn(function* (field: "messageID" | "to", id: SessionMessage.ID) {
    const row = users.find((row) => row.id === id)
    if (!row) return yield* new MessageNotFoundError({ sessionID, messageID: id })
    if (row.type !== "user")
      return yield* new TurnRangeError({ sessionID, field, message: `Message ${id} is not a user message` })
    return row
  })
  const start = input.messageID
    ? yield* resolve("messageID", input.messageID)
    : users.findLast((row) => row.type === "user")
  if (!start) return []
  const last = input.to ? yield* resolve("to", input.to) : start
  if (last.seq < start.seq)
    return yield* new TurnRangeError({ sessionID, field: "to", message: `Message ${last.id} precedes ${start.id}` })
  const next = users.find((row) => row.type === "user" && row.seq > last.seq)
  const steps = yield* db
    .select({
      seq: SessionMessageTable.seq,
      start: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.snapshot.start')`,
      end: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.snapshot.end')`,
      completed: sql<number | null>`json_extract(${SessionMessageTable.data}, '$.time.completed')`,
    })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),
        eq(SessionMessageTable.type, "assistant"),
        gt(SessionMessageTable.seq, start.seq),
        next ? lt(SessionMessageTable.seq, next.seq) : undefined,
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const first = steps[0]
  const final = steps[steps.length - 1]
  const from = steps.find((step) => step.start)?.start
  if (!first || !final || !from) return []
  const switches = yield* db
    .select({
      seq: SessionMessageTable.seq,
      location: sql<string>`json_extract(${SessionMessageTable.data}, '$.location')`,
      previous: sql<string | null>`json_extract(${SessionMessageTable.data}, '$.previous.location')`,
    })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "location-switched")))
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  if (switches.some((row) => row.seq > first.seq && row.seq < final.seq))
    return yield* new TurnRangeError({ sessionID, field: "to", message: "Turn range spans a location change" })
  const before = switches.findLast((row) => row.seq < first.seq)?.location
  const after = switches.find((row) => row.seq > first.seq)?.previous
  const location = before ? decodeLocation(before) : after ? decodeLocation(after) : input.session.location
  const recorded = steps.findLast((step) => step.end)?.end
  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const running = input.active && final.completed === null
    const to = running ? ((yield* snapshot.capture()) ?? recorded) : recorded
    if (!to) return []
    return yield* snapshot.diff({
      from: Snapshot.ID.make(from),
      to: Snapshot.ID.make(to),
      context: input.context ?? PATCH_CONTEXT_LINES,
    })
  }).pipe(Effect.provide(locations.get(location)))
})
