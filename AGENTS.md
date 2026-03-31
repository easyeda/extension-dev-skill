# AGENTS.md — Agent Instructions for extension-dev-skill

## Project Overview

extension-dev-skill — An AI Skill for building EasyEDA Pro extension plugins. Provides API query standards, code generation templates, and a debugging toolchain.

**Language**: TypeScript (plugin code)
**Runtime**: EasyEDA Pro extension sandbox (browser environment, not Node.js)
**API Documentation**: `resources/` directory (guide + references)

> For core workflow, execution steps, and runtime constraints, see `SKILL.md`.
> This file covers supplementary rules and conventions that are not in `SKILL.md`.

## Directory Structure

```
extension-dev-skill/
  SKILL.md                          # Skill definition (core rules and workflow)
  AGENTS.md                         # Supplementary agent guide (this file)
  resources/
    experience.md                   # Common pitfalls and lessons learned
    guide/                          # Developer guide (concepts, how-to, best practices)
    references/                     # Complete API reference (classes, enums, interfaces, types)
      _index.md                     # Master index of all API entities
      _quick-reference.md           # All method signatures for rapid lookup
      classes/                      # 120 class docs
      enums/                        # 62 enum docs
      interfaces/                   # 70 interface docs
      types/                        # 19 type alias docs
```

## API Documentation Source

The `resources/` directory is the authoritative API documentation source.
- `resources/references/` — Complete API reference with all classes, enums, interfaces, and type aliases
- `resources/guide/` — Developer guide covering concepts, setup, debugging, and best practices
- Always look up APIs in these docs; do not guess from memory

### Lookup Priority

1. **Find the class** → `resources/references/_index.md` or `resources/references/classes/<ClassName>.md`
2. **Quick signature lookup** → `resources/references/_quick-reference.md`
3. **Check mount path** → `resources/references/classes/EDA.md`
4. **Check parameter/return types** → `resources/references/enums/` and `resources/references/interfaces/`
5. **Understand concepts** → `resources/guide/` (invoke-apis, extension-json, i18n, inline-frame, etc.)

## grepSearch Standards

| Search Target | Correct | Incorrect |
|---------------|---------|-----------|
| Class/Interface name | `SCH_PrimitiveComponent` | `class SCH_PrimitiveComponent` |
| Method name | `getCurrentDocumentInfo` | `function getCurrentDocumentInfo` |
| Enum name | `EDMT_EditorDocumentType` | `enum EDMT_EditorDocumentType` |
| eda property | `dmt_SelectControl` | `eda.dmt_SelectControl` |

When searching, prefer reading the specific doc file directly (e.g., `readFile "resources/references/classes/DMT_SelectControl.md"`) over broad grepSearch when you already know the class name.

## Recursive Query Triggers

When an API query result contains any of the following, you must continue querying recursively:

1. Returns `Promise<IPCB_*>` or `Promise<ISCH_*>` → Read the corresponding interface doc in `references/interfaces/`
2. Parameter contains a complex interface → Read its interface doc for property structure
3. Interface has inheritance → Read both parent and child class/interface docs
4. Return value is a union type → Read each member's doc
5. Enum type parameter → Read the enum doc in `references/enums/` for all possible values

## Code Generation Rules

> Core rules (try/catch wrapping, browser API restrictions, error handling standards) are defined in `SKILL.md`. The following are additional conventions:

### CRITICAL: Lint After Every File Write

**After writing or modifying ANY `.ts`, `.js`, or `.html` file — no exceptions — you MUST immediately run:**

```bash
node <skill-path>/scripts/lint-eda-api.js <the-file-you-just-edited>
```

This applies to ALL files in the project, including but not limited to:
- `src/index.ts` or any `.ts` file under `src/`
- `iframe/index.html` or any `.html` file under `iframe/`
- Any other `.ts`, `.js`, `.html` file anywhere in the project

If the linter reports errors, fix them and re-run until zero errors. Do NOT proceed to the next file or task until the current file passes.

If `<skill-path>/scripts/api-registry.json` does not exist, run `node <skill-path>/scripts/build-registry.js` first.

### Other Conventions

- npm dependencies can be imported as needed; update `package.json` accordingly
- Use `console.error('[PluginName]', ...)` in `catch` blocks for error traceability
- Use `console.warn('[PluginName]', ...)` for non-critical issues (fallback values, empty results, deprecated usage)
- Never use `console.log` in production code; only `console.warn` and `console.error` are allowed
- Define a `PLUGIN_TAG` constant at the top of each file for consistent log prefixes
- Prefer `async/await` over `.then()` chains for readability
- All generated code must be valid TypeScript; do not use `any` unless unavoidable
- Always add defensive null/undefined checks on API return values before use
- After code generation, generate or update the plugin project's `README.md` and `CHANGELOG.md`

## Generated Plugin Project Structure

```
├── src/                 Main plugin code (src/index.ts is the entry point)
├── iframe/              Frontend code for custom UI panels
├── locales/             i18n files (en.json + zh-Hans.json)
├── images/              Extension preview images (logo.png + banner.png)
├── build/               Build output directory
├── extension.json       Plugin metadata and menu configuration
├── package.json         NPM configuration
└── tsconfig.json        TypeScript compilation configuration
```

## extension.json headerMenus ID Rules

All `headerMenus[].id` values in `extension.json` must be globally unique across ALL editor pages (home, sch, pcb, footprint, panel, etc.). Duplicate IDs — even across different pages — cause only the first menu to render.

- Always use a plugin-specific prefix: `myplugin-home-export`, `myplugin-sch-export`
- Before finalizing `extension.json`, scan all IDs across all editor pages and reject any duplicates
- Nested `menuItems` IDs must also be unique

## Auto-Deploy After Build

After plugin code generation and build (`npm run build`):

1. Check if `eext-dev-mcp` MCP tools are available (try calling `dev_plugin`)
2. If available: find the `.eext` file path in `build/dist/`, call `dev_plugin` to auto-import into the browser
3. If not available: inform the user to manually upload the `.eext` file via the EDA Extension Manager

## MCP Debugging Workflow (Optional)

Requires the `eext-dev-mcp` MCP service:

1. Build the plugin: `npm run build` (output in `build/dist/*.eext`)
2. Use `listDirectory` to find the absolute path of the `.eext` file
3. Use MCP tool `dev_plugin` to import
4. Use MCP tool `get_console_logs` to retrieve logs
5. Fix issues and repeat

Without MCP installed, manually upload the `.zip` file in the EDA Extension Manager.

## Do Not Modify

- `resources/guide/` and `resources/references/` — API documentation source; do not edit manually
- `SKILL.md` front matter — Contains Skill metadata

## EDA API Linter

A custom linter script is available at `scripts/lint-eda-api.js` to validate EDA API usage in generated code. It checks against an API registry built from the `resources/references/` documentation.

### Setup

```bash
# Build the API registry (run once, or after API docs update)
node scripts/build-registry.js
```

### Usage

```bash
# Lint entire project (recursively scans all .ts / .html, skips node_modules/build/dist)
node scripts/lint-eda-api.js .

# Lint a single file
node scripts/lint-eda-api.js src/index.ts

# Lint a specific directory
node scripts/lint-eda-api.js src/ iframe/

# JSON output (for programmatic consumption)
node scripts/lint-eda-api.js . --json
```

Supports `.ts`, `.js`, and `.html` files (extracts `<script>` content from HTML).

### Mandatory Usage

**Every time you write or modify a `.ts`, `.js`, or `.html` file, you MUST run the linter on that file immediately.** This is defined as Core Principle #7 in `SKILL.md`. See the "Mandatory: EDA API Linter" section in `SKILL.md` for full details.
