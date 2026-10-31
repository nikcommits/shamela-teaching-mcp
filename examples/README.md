# Configuration examples

Use these only when you do **not** install the `.mcpb` bundle (which needs no configuration
file). Build first: `npm install && npm run build`. Empty values mean "auto-detect / default".

## Claude Desktop (manual)

Merge [`claude_desktop_config.json`](claude_desktop_config.json) into
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

and replace `/ABSOLUTE/PATH/TO/` with where you cloned the repository.

## Claude Code

```bash
claude mcp add shamela-teaching --env TEACHING_LANG=ar -- node /ABSOLUTE/PATH/TO/shamela-teaching-mcp/dist/index.js
```

Skill: copy `skills/shamela-teaching` to `~/.claude/skills/` (all projects) or to
`.claude/skills/` inside one project.

## Other MCP hosts

Any host that starts stdio servers: command `node`, argument the absolute path of
`dist/index.js`, environment variables as listed in the main README. If the host does not load
skills, give it the content of `skills/shamela-teaching/SKILL.md` as instructions.
