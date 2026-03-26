# Milestones

1. Multiple workflows per repo
Allow more than one learned workflow to apply to the same repo. Introduce priority and selection rules (e.g., highest priority wins, or explicit `active: true`). Provide `workflow list` output with priority order and a `workflow set-active` command to switch.

2. Offline learn
Support learning without network access. Options include a `--offline` flag to skip all validations and URL fetching, and strict local‑file input only. This should still allow reusing existing cached workflows.
