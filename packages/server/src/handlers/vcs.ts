import { Session } from "@opencode-ai/core/session"
import { Vcs } from "@opencode-ai/core/vcs"
import { InvalidRequestError, ServiceUnavailableError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { response } from "../location"
import { missingSession } from "./session-error"

export const VcsHandler = HttpApiBuilder.group(Api, "server.vcs", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return handlers
      .handle("vcs.get", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.info()
          }),
        ),
      )
      .handle("vcs.base", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs
              .base()
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
      .handle("vcs.status", () =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.status()
          }),
        ),
      )
      .handle("vcs.branches", (ctx) =>
        response(
          Effect.gen(function* () {
            const vcs = yield* Vcs.Service
            return yield* vcs.branches({ search: ctx.query.search, limit: Math.min(ctx.query.limit ?? 50, 100) })
          }),
        ),
      )
      .handle("vcs.diff", (ctx) =>
        response(
          Effect.gen(function* () {
            if (ctx.query.mode === "turn") {
              if (!ctx.query.sessionID)
                return yield* new InvalidRequestError({
                  message: "The turn diff source requires a sessionID",
                  field: "sessionID",
                })
              return yield* session.turnDiff({ sessionID: ctx.query.sessionID, context: ctx.query.context }).pipe(
                Effect.catchTag("Session.NotFoundError", missingSession),
                Effect.catchTag(
                  "Snapshot.Error",
                  (error) => new ServiceUnavailableError({ service: "snapshot", message: error.message }),
                ),
              )
            }
            const vcs = yield* Vcs.Service
            return yield* vcs
              .diff(ctx.query.mode, { context: ctx.query.context, base: ctx.query.base })
              .pipe(Effect.mapError((error) => new ServiceUnavailableError({ service: "vcs", message: error.message })))
          }),
        ),
      )
  }),
)
