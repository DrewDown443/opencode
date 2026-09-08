# Mention styling comparisons

Before/after screenshots for file and agent mentions in local and worktree user-message bubbles, in light and dark mode.

- Baseline: `5c30292daa` (`v2` before the mention changes).
- Fixture: `current-session-timeline-rows--conversation`, `scenario:attachments`.
- Each image contains `@explore` and `@src/a.ts`, before and after.
- Screenshots use the production message DOM and theme styles. The Before row restores the baseline mention markup and CSS rules from `v2`; the After row uses the current renderer. Local/worktree attributes match the production timeline's presentation attributes.
- Both mention names and their `@` prefixes use weight 600 after the change.

The screenshots live on an evidence-only branch so they can be embedded in the PR without adding binary review artifacts to the implementation diff.
