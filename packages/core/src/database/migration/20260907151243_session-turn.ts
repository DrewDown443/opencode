import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260907151243_session-turn",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`session_turn\` (
          \`session_id\` text NOT NULL,
          \`start_seq\` integer NOT NULL,
          \`end_seq\` integer,
          \`status\` text NOT NULL,
          \`time_started\` integer NOT NULL,
          \`time_ended\` integer,
          CONSTRAINT \`session_turn_pk\` PRIMARY KEY(\`session_id\`, \`start_seq\`),
          CONSTRAINT \`fk_session_turn_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
    })
  },
}

export default migration
