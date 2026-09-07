export * as SessionTurnDiff from "./turn-diff.js"

import { and, asc, desc, eq, gt } from "drizzle-orm"
import { Effect, Schema } from "effect"
import { Database } from "../database/database.js"
import { Instance } from "../instance/service.js"
import { Snapshot } from "../snapshot.js"
import { PATCH_CONTEXT_LINES } from "../vcs/patch.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionMessageTable } from "./sql.js"

/**
 * Diff the files changed by the Session's last turn: every step recorded after
 * the newest user message. Compares the first step's start snapshot with the
 * final step's end snapshot, or with the working copy while that step is still
 * running so an in-progress turn stays visible.
 *
 * Returns no diffs when the Session has no user message, no step recorded a
 * snapshot, or snapshots are disabled for the Session's Location. Like VCS
 * diffs, an omitted `context` yields full-file patches.
 */
export const last = Effect.fn("SessionTurnDiff.last")(function* (input: {
  readonly session: SessionSchema.Info
  readonly context?: number
}) {
  const database = yield* Database.Service
  const instances = yield* Instance.Service
  const boundary = yield* database.db
    .select({ seq: SessionMessageTable.seq })
    .from(SessionMessageTable)
    .where(and(eq(SessionMessageTable.session_id, input.session.id), eq(SessionMessageTable.type, "user")))
    .orderBy(desc(SessionMessageTable.seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  if (!boundary) return []
  const rows = yield* database.db
    .select({ id: SessionMessageTable.id, type: SessionMessageTable.type, data: SessionMessageTable.data })
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, input.session.id),
        eq(SessionMessageTable.type, "assistant"),
        gt(SessionMessageTable.seq, boundary.seq),
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)
  const steps = yield* Effect.forEach(rows, (row) =>
    decodeStep({ ...row.data, id: row.id, type: row.type }).pipe(Effect.orDie),
  )
  const from = steps.find((step) => step.snapshot?.start)?.snapshot?.start
  if (!from) return []
  return yield* Effect.gen(function* () {
    const snapshot = yield* Snapshot.Service
    const to = steps.at(-1)?.snapshot?.end ?? (yield* snapshot.capture())
    if (!to) return []
    return yield* snapshot.diff({ from, to, context: input.context ?? PATCH_CONTEXT_LINES })
  }).pipe(instances.provide(input.session))
})

const decodeStep = Schema.decodeUnknownEffect(SessionMessage.Assistant)
