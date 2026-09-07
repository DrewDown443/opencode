export * as SessionTurn from "./turn.js"

import { asc, eq, sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Location } from "@opencode-ai/schema/location"
import { Database } from "../database/database.js"
import { LocationServiceMap } from "../location-service-map.js"
import { RelativePath } from "../schema.js"
import { Snapshot } from "../snapshot.js"
import { PATCH_CONTEXT_LINES } from "../vcs/patch.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionMessageTable, SessionTurnTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]

export class TurnRangeError extends Schema.TaggedError<TurnRangeError>()("Session.TurnRangeError", {
  sessionID: SessionSchema.ID,
  field: Schema.Literals(["from", "to"]).pipe(Schema.optional),
  message: Schema.String,
}) {}

/**
 * The facts a turn needs from a projected message, extracted in SQL so tool
 * output blobs never leave the database.
 */
const MessageRow = Schema.Struct({
  id: SessionMessage.ID,
  type: Schema.String,
  seq: Schema.Number,
  start: Schema.NullOr(Snapshot.ID),
  end: Schema.NullOr(Snapshot.ID),
  files: Schema.NullOr(Schema.fromJsonString(Schema.Array(RelativePath))),
  completed: Schema.NullOr(Schema.Number),
  location: Schema.NullOr(Schema.fromJsonString(Location.Ref)),
  previous: Schema.NullOr(Schema.fromJsonString(Location.Ref)),
})
type MessageRow = typeof MessageRow.Type
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(MessageRow))

export interface Entry {
  readonly turn: SessionSchema.Turn
  readonly steps: readonly MessageRow[]
}

/**
 * Turns in chronological order. A turn is one busy period of the Session; periods
 * without an assistant step (no-op wakes) are dropped and do not consume an
 * ordinal. Forks list the turns copied with their history.
 */
export const list = Effect.fn("SessionTurn.list")(function* (db: DatabaseService, session: SessionSchema.Info) {
  return (yield* load(db, session)).entries
})

/**
 * Diff the files changed across a contiguous turn range: the range's first
 * recorded start snapshot against its last recorded end snapshot. Only a range
 * whose last step is still running compares against the working copy.
 *
 * Omitting both bounds selects the last turn, `from` alone extends to the last
 * turn, and `to` alone starts at the first turn. Like VCS diffs, an omitted
 * `context` yields full-file patches.
 */
export const diff = Effect.fn("SessionTurn.diff")(function* (input: {
  readonly session: SessionSchema.Info
  readonly from?: number
  readonly to?: number
  readonly context?: number
}) {
  const database = yield* Database.Service
  const locations = yield* LocationServiceMap.Service
  const loaded = yield* load(database.db, input.session)
  const count = loaded.entries.length
  if (count === 0 && input.from === undefined && input.to === undefined) return []
  const to = input.to ?? count
  const from = input.from ?? (input.to === undefined ? count : 1)
  if (to < 1 || to > count)
    return yield* new TurnRangeError({ sessionID: input.session.id, field: "to", message: `Turn ${to} does not exist` })
  if (from < 1 || from > to)
    return yield* new TurnRangeError({
      sessionID: input.session.id,
      field: "from",
      message: from > count ? `Turn ${from} does not exist` : `Turn range must start at or before turn ${to}`,
    })
  const selected = loaded.entries.slice(from - 1, to)
  const steps = selected.flatMap((entry) => entry.steps)
  const first = steps[0]
  const last = steps[steps.length - 1]
  // Snapshot trees live in the repository of the Location that captured them.
  if (loaded.switches.some((row) => row.seq > first.seq && row.seq < last.seq))
    return yield* new TurnRangeError({ sessionID: input.session.id, message: "Turn range spans a location change" })
  const start = steps.find((step) => step.start)?.start
  if (!start) return []
  const recorded = steps.findLast((step) => step.end)?.end
  const running = selected[selected.length - 1].turn.status === "running" && last.completed === null
  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const end = running ? ((yield* snapshot.capture()) ?? recorded) : recorded
    if (!end) return []
    return yield* snapshot.diff({ from: start, to: end, context: input.context ?? PATCH_CONTEXT_LINES })
  }).pipe(Effect.provide(locations.get(selected[0].turn.location)))
})

const load = Effect.fn("SessionTurn.load")(function* (db: DatabaseService, session: SessionSchema.Info) {
  const spans = yield* db
    .select()
    .from(SessionTurnTable)
    .where(eq(SessionTurnTable.session_id, session.id))
    .orderBy(asc(SessionTurnTable.start_seq))
    .all()
    .pipe(Effect.orDie)
  const raw = yield* db
    .all(
      sql`
        SELECT
          id,
          type,
          seq,
          json_extract(data, '$.snapshot.start') AS start,
          json_extract(data, '$.snapshot.end') AS "end",
          json_extract(data, '$.snapshot.files') AS files,
          json_extract(data, '$.time.completed') AS completed,
          json_extract(data, '$.location') AS location,
          json_extract(data, '$.previous.location') AS previous
        FROM ${SessionMessageTable}
        WHERE session_id = ${session.id}
        ORDER BY seq ASC
      `,
    )
    .pipe(Effect.orDie)
  const rows = yield* decodeRows(raw).pipe(Effect.orDie)
  const switches = rows.filter((row) => row.type === "location-switched")
  const locationAt = (seq: number) =>
    switches.find((row) => row.seq > seq)?.previous ??
    switches.findLast((row) => row.seq < seq)?.location ??
    session.location
  const entries = spans.flatMap((span) => {
    const messages = rows.filter((row) => row.seq > span.start_seq && (span.end_seq === null || row.seq < span.end_seq))
    const steps = messages.filter((row) => row.type === "assistant")
    if (steps.length === 0) return []
    return [{ span, steps, first: messages[0], last: messages[messages.length - 1] }]
  })
  return {
    switches,
    entries: entries.map(
      (entry, index): Entry => ({
        turn: {
          ordinal: index + 1,
          status: entry.span.status,
          time: {
            started: DateTime.makeUnsafe(entry.span.time_started),
            ended: entry.span.time_ended === null ? undefined : DateTime.makeUnsafe(entry.span.time_ended),
          },
          messages: { first: entry.first.id, last: entry.last.id },
          location: locationAt(entry.steps[0].seq),
          files: [...new Set(entry.steps.flatMap((step) => step.files ?? []))],
        },
        steps: entry.steps,
      }),
    ),
  }
})
