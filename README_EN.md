English | **[中文](README.md)**

# extension-dev-skill

An AI Skill for JLCEDA / EasyEDA Pro extension plugin development. Enables AI Agents to automatically query APIs, generate code, and build plugins.

## Features

- Optimized for [pro-api-sdk](https://github.com/easyeda/pro-api-sdk)
- Documentation-driven code generation based on easyeda-api-skill
- MCP debugging toolchain support for automated build → import → log monitoring

## Quick Start

### 1. Locate or Create the Skills Directory

Follow your AI Agent's documentation to find or create the skills directory:

| Agent Scope | Directory |
|------------|-----------|
| Project-level | `.agents/skills/` |
| Global-level | `~/.agents/skills/` |

### 2. Clone the Repository

```bash
git clone https://github.com/easyeda/extension-dev-skill
```

### 3. Verify

Confirm the skill is loaded in your AI Agent.

For example in OpenCode: run `/skills` and check that `extension-dev-skill` is listed.

## How It Works

The Skill defines a workflow that AI Agents follow when generating plugin code:

```
Plan → Init → API Query → Signature Validation → Confirm → Code Generation → Constraint Check → Doc → Deploy
```

### Execution Workflow

| Step | Name | Description |
|------|------|-------------|
| 1 | Plan | Understand requirements, confirm target editor and core functionality |
| 2 | Init | Initialize project if workspace is not set up |
| 3 | Query | Four-step API lookup; every API must be verified against docs |
| 4 | Validate | Confirm all type signatures are complete; go back to Query if uncertain |
| 5 | Confirm | Present implementation plan to user and wait for confirmation |
| 6 | Execute | Generate code with try/catch wrapped API calls |
| 7 | Check | Runtime constraint check, menu ID uniqueness validation |
| 8 | Doc | Generate/update README.md and CHANGELOG.md |
| 9 | Deploy | Build and import the plugin |

### API Query Flow

1. Find the target class in `resources/references/classes/`
2. Verify the class mount path on the `eda` object via `EDA.md`
3. Confirm method signatures, parameter types, and return types
4. Recursively query return interface methods

## MCP Debugging Tools (Optional)

[extension-dev-mcp-tools](https://github.com/easyeda/extension-dev-mcp-tools)

With MCP installed, the AI Agent supports: build `.eext` → import to browser → retrieve console logs.

## Directory Structure

```
extension-dev-skill/
├── SKILL.md                # Core skill definition (workflow, runtime constraints, error handling)
├── AGENTS.md               # Supplementary agent guide (search standards, recursive queries, conventions)
├── CHANGELOG.md            # Changelog
├── README.md               # Project description (Chinese)
├── README_EN.md            # Project description (English, this file)
└── resources/
    ├── api-reference.md    # API module overview, eda property list, MCP tool docs
    ├── experience.md       # Common pitfalls and lessons learned
    ├── guide/              # Developer guide (concepts, how-to, best practices)
    └── references/         # Complete API reference
        ├── _index.md       # Master index of all API entities
        ├── _quick-reference.md  # Method signature quick reference
        ├── classes/        # 120 class docs
        ├── enums/          # 62 enum docs
        ├── interfaces/     # 70 interface docs
        └── types/          # 19 type alias docs
```

## Demo Video

Based on OpenCode:

https://github.com/user-attachments/assets/742954b8-9527-43ad-ae08-3f08ec083fa2
