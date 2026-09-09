# Slash-command follow-up behavior

Both screenshots submit `/review current changes` with the follow-up preference set to **Queue** while a session is running.

- `before.png`: production build of `v2` at `1dcc6551d9`; the command is sent as Steer.
- `after.png`: production build with this fix; the command appears in the queue above the composer.

Captured with the fixture-backed `slash commands respect queue preference and alternate submit` Playwright scenario in `packages/app/e2e/regression/session-queue.spec.ts`. The production UI is rendered against an isolated command/session fixture.
