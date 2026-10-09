@AGENTS.md

## gstack

This project uses [gstack](https://github.com/garrytan/gstack), installed globally at `~/.claude/skills/gstack`. The full skill list is in the global `~/.claude/CLAUDE.md`.

- Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
- Typical flow: `/office-hours` or `/spec` to shape an idea, `/plan-eng-review` before building, `/review` before landing, `/qa` to test the running app, `/ship` to land. `/investigate` for bugs.
- Pushing to `main` deploys, so `/ship` and `/land-and-deploy` are deploys. Both need `npm run lint`, `npm test` and `npm run build` to pass first.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
- MK Mobile patch notes → invoke /patch-notes
