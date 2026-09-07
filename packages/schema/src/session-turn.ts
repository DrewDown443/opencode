import { Schema } from "effect"
import { Location } from "./location.js"
import { DateTimeUtcFromMillis, optional, PositiveInt, RelativePath } from "./schema.js"
import { SessionMessage } from "./session-message.js"

/** Outcome of the execution that produced the turn; `running` while it is still open. */
export const Status = Schema.Literals(["running", "succeeded", "failed", "interrupted"]).annotate({
  identifier: "Session.Turn.Status",
})
export type Status = typeof Status.Type

/**
 * One busy period of a Session: everything between prompt promotion and the
 * next idle state, including steers and queued prompts delivered while busy.
 */
export interface Turn extends Schema.Schema.Type<typeof Turn> {}
export const Turn = Schema.Struct({
  /** 1-based chronological position. Only shifts when a revert truncates history. */
  ordinal: PositiveInt,
  status: Status,
  time: Schema.Struct({
    started: DateTimeUtcFromMillis,
    ended: DateTimeUtcFromMillis.pipe(optional),
  }),
  /** Visible message span of the turn; `first` is usually the promoted prompt. */
  messages: Schema.Struct({
    first: SessionMessage.ID,
    last: SessionMessage.ID,
  }),
  /** Location of the turn's first step. */
  location: Location.Ref,
  /** Files the turn's steps recorded as changed. The turn diff is the source of truth. */
  files: Schema.Array(RelativePath),
}).annotate({ identifier: "Session.Turn" })
