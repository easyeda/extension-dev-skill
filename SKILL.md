---
name: extension-dev-skill
description: >-
  AI Skill for building EasyEDA Pro extension plugins. Used when users need to create,
  modify, or debug EasyEDA Pro plugins, including generating plugin code,
  querying API documentation, configuring extension.json, and handling i18n localization.
  Trigger words: "EasyEDA", "嘉立创EDA", "EDA plugin", "EDA extension", "extension.json",
  "pro-api-types", "原理图", "PCB设计"
license: MIT
compatibility: Build requires Node.js 18+; runtime is EasyEDA Pro browser sandbox
metadata:
  author: JLCEDA
  version: "1.3.3"
---

# extension-dev-skill

AI Skill for EasyEDA Pro extension plugin development. Provides a complete API query workflow, code generation standards, and debugging toolchain.

## Core Principles

1. **Never guess APIs** — Check the `resources/references/` documentation first; if not found = does not exist
2. **Verify class existence before use** — Search class name in `resources/references/classes/`; no matching doc = do not use
3. **Verify API mount path** — The class where a method is defined ≠ the property it's mounted on under `eda`
4. **Verify return type methods** — Different methods on the same class may return completely different interface types
5. **Browser APIs are forbidden in the main process** — Cannot use `localStorage`, `window`, `document`; allowed inside iframe
6. **Document type values** — SCH=1, PCB=3, FOOTPRINT=4 (PCB is not 2)
7. **Lint after every file edit** — Every time you write or modify a `.ts`, `.js`, or `.html` file, immediately run the EDA API linter on that file. Fix all errors before moving on. This is mandatory, not optional

## When to Use

**Applicable:**
- Creating or modifying EasyEDA Pro extension plugins
- Querying API method signatures via the `resources/` documentation
- Configuring `extension.json`, locales i18n files, or build processes
- Automating plugin import/debugging via `eext-dev-mcp` MCP tools

**Not applicable:**
- General TypeScript/JavaScript questions unrelated to EasyEDA Pro
- Non-EasyEDA Pro EDA tools
- Workspace has no `extension.json` and user did not request initialization

## API Documentation Structure

API documentation is located in the `resources/` directory bundled with this Skill:

```
resources/
  experience.md                     # Common pitfalls and lessons learned
  guide/                            # Developer guide (how-to, concepts, best practices)
    index.md                        # What is the Extension API
    how-to-start.md                 # Environment setup and first extension
    invoke-apis.md                  # How to call APIs + debugging methods
    extension-json.md               # extension.json configuration reference
    i18n.md                         # Multi-language support
    inline-frame.md                 # IFrame custom UI windows
    error-handling.md               # Error handling and safety mode
    stability.md                    # API versioning and stability policy
  references/                       # Complete API reference
    _index.md                       # Master index of all classes, enums, interfaces, types
    _quick-reference.md             # All method signatures for rapid lookup
    classes/                        # 120 class docs (DMT_*, PCB_*, SCH_*, LIB_*, SYS_*, IPCB_*, ISCH_*)
    enums/                          # 62 enum docs
    interfaces/                     # 70 interface docs
    types/                          # 19 type alias docs
```

### How to Look Up API

1. **Start with `references/_index.md`** to find the right class/module for the task
2. **Read the class doc** (e.g., `references/classes/DMT_Board.md`) for all methods and signatures
3. **Use `references/_quick-reference.md`** for fast method signature lookup across all classes
4. **Check `references/enums/`** for enum values and `references/interfaces/` for parameter/return types
5. **Read `guide/` files** for concepts, patterns, and best practices

## API Query Workflow (Four Steps)

### Step 1: Find the Correct Class

Search in `resources/references/classes/` for the relevant class document:

```bash
# Use grepSearch to find the class in the references directory
grepSearch "SCH_PrimitiveComponent"   # Schematic component class
grepSearch "PCB_PrimitiveVia"         # PCB via class
```

Or directly read the class doc:
```bash
readFile "resources/references/classes/SCH_PrimitiveComponent.md"
readFile "resources/references/classes/PCB_PrimitiveVia.md"
```

### Step 2: Verify the Class Is Mounted on the eda Object

Check `resources/references/classes/EDA.md` or `resources/references/_index.md` to confirm the mount path:

```bash
# Read the EDA class doc to see all mounted properties
readFile "resources/references/classes/EDA.md"
```

Or search in the quick reference:
```bash
grepSearch "sch_PrimitiveComponent"   # Verify mount path
grepSearch "dmt_SelectControl"        # Verify mount path
```

### Step 3: Find the Method and Confirm Its Signature

Read the specific class document to find the method signature:

```bash
# Read the full class doc for all methods
readFile "resources/references/classes/DMT_SelectControl.md"
```

Or search across references for a specific method:
```bash
grepSearch "getCurrentDocumentInfo"
```

### Step 4: Verify the Return Interface Has the Required Methods

Read the interface document for the return type:

```bash
# If a method returns IDMT_EditorDocumentItem, read its interface doc
readFile "resources/references/interfaces/IDMT_EditorDocumentItem.md"
```

**No matching document = does not exist. Do not use!**

## Execution Workflow

1. **Plan** — Understand requirements, confirm target editor (home/sch/pcb) and core functionality
2. **Init** — If workspace is not initialized, run project initialization; otherwise skip
3. **Query** — Dynamically query required APIs (four-step method); every API must be verified against `resources/references/`
4. **Validate** — Verify all type signatures are complete with no guesswork; if uncertain, return to Query
5. **Confirm** — Present implementation plan to user (API list, dependencies, data flow, file changes); wait for confirmation in Supervised mode. In Autopilot mode, skip this step for straightforward changes; only pause for complex or destructive operations
6. **Execute** — Generate code; each API call corresponds to a verified signature, wrapped in `try/catch` with proper logging. **After writing or modifying each `.ts`/`.js`/`.html` file, immediately run `node <skill-path>/scripts/lint-eda-api.js <file>` and fix all errors before touching the next file**
7. **Check** — Check runtime environment constraints; confirm no forbidden operations; verify all `headerMenus` IDs in `extension.json` are globally unique across all editor pages; if violations found, return to Execute to fix
8. **Doc（文档）** — After code generation is complete, generate or update the plugin project's `README.md` and `CHANGELOG.md`; README should include feature description, usage instructions, build steps, and configuration notes; CHANGELOG should follow [Keep a Changelog](https://keepachangelog.com/) format to record changes
9. **Deploy** — Run `npm run build`; if `eext-dev-mcp` MCP tools are available, automatically find the `.eext` file path and call `dev_plugin` to import the plugin into the browser for testing; if MCP is not installed, inform the user to manually upload the `.eext` file

### API Verification Checklist (Required Before Using Any API)

- [ ] Found the class document in `resources/references/classes/`; confirmed method exists with return type
- [ ] Read the full method signature from the class doc; confirmed all parameter types and counts
- [ ] Confirmed `eda.xxx_YYY` property exists in `resources/references/classes/EDA.md`
- [ ] Confirmed API is mounted on the correct module
- [ ] Verified the returned interface type also has the required methods (checked in `references/interfaces/`)
- [ ] If using `getAllPrimitiveId`, must use a concrete type (not an abstract class)
- [ ] Document type checks use the correct `documentType` values (checked in `references/enums/`)
- [ ] All `headerMenus` IDs in `extension.json` are globally unique across every editor page (home/sch/pcb/footprint/panel etc.); duplicate IDs cause only the first menu to render

## Runtime Environment Constraints

| Requirement | Recommended API |
|-------------|----------------|
| Get user input | `eda.sys_Dialog.showInputDialog()` |
| User selection | `eda.sys_Dialog.showSelectDialog()` |
| Show message | `eda.sys_Dialog.showInformationMessage()` |
| Confirm action | `eda.sys_Dialog.showConfirmationMessage()` |
| Toast notification | `eda.sys_Message.showToastMessage()` |
| Store data | `eda.sys_Storage.setExtensionUserConfig(key, value)` |
| Custom UI | `eda.sys_IFrame.openIFrame()` |
| Open link | `eda.sys_Window.open()` |
| Browser hardware API | Available in iframe (`navigator.serial`, etc.) |
| IFrame data passing | Option A (recommended): Store with `eda.sys_Storage.setExtensionUserConfig(key, value)`, read in iframe with `getExtensionUserConfig(key)`; Option B: Call eda API directly from iframe (both main process and iframe can access the `eda` object; just use `eda` directly) |

> Forbidden patterns (`alert()`, `confirm()`, `localStorage`, `window.open()`, `window.eda`, `window.parent.eda`, `(window as any).__xxx`, DOM manipulation, `console.log`) are automatically detected by the EDA API linter.

## Error Handling and Logging Standards

All generated plugin code must follow these error handling and logging conventions:

### Logging Levels

| Level | API | Usage |
|-------|-----|-------|
| Warning | `console.warn('[PluginName]', ...)` | Non-critical issues: fallback values used, deprecated API detected, unexpected but recoverable state |
| Error | `console.error('[PluginName]', ...)` | Failures: API call failed, data missing, operation aborted |

- Always prefix log messages with the plugin name in brackets for traceability: `[MyPlugin]`

### try/catch Wrapping Rules

1. Every `eda.*` API call must be wrapped in `try/catch`
2. Catch blocks must log with `console.error` and include the error object
3. Group related API calls in a single `try/catch` when they share a logical operation
4. Provide user-facing feedback on failure via `eda.sys_Dialog.showInformationMessage()` or `eda.sys_Message.showToastMessage()`

### Code Pattern

```typescript
// [Correct]: structured error handling with logging
const PLUGIN_TAG = '[MyPlugin]';

export async function myFeature() {
  try {
    const docInfo = await eda.dmt_SelectControl.getCurrentDocumentInfo();
    if (!docInfo) {
      console.warn(PLUGIN_TAG, 'No active document found, aborting');
      return;
    }
    // ... business logic
  } catch (err) {
    console.error(PLUGIN_TAG, 'Failed to execute myFeature:', err);
    await eda.sys_Dialog.showInformationMessage('Operation failed. Check console for details.');
  }
}
```

### Defensive Checks

- Validate return values before use (null/undefined checks)
- Validate array lengths before iteration
- Validate document type before performing editor-specific operations

```typescript
const components = await eda.sch_PrimitiveComponent.getAll();
if (!components || components.length === 0) {
  console.warn(PLUGIN_TAG, 'No components found in current schematic');
  return;
}
```

## Project Initialization

When `extension.json` does not exist in the workspace:

```bash
git clone https://github.com/easyeda/pro-api-sdk.git <project-name>
cd <project-name>
npm install
npm run build
```

## Failure Strategies

- API does not exist: Stop immediately, inform the user
- Signature uncertain: Stop generation, return to query step
- Workspace not initialized: Prompt user to initialize first
- Forbidden DOM API used: Automatically replace with `eda.sys_*` alternatives
- Menu ID conflict: **headerMenus IDs must be globally unique across ALL editor pages (home/sch/pcb/footprint/panel etc.)**; always add a plugin-specific prefix (e.g., `myplugin-home-export`, `myplugin-sch-export`); duplicate IDs — even across different editor pages — cause only the first menu to render. Before finalizing `extension.json`, scan all IDs and reject any duplicates

## Plugin Documentation Generation

After generating plugin code, always create or update the plugin project's `README.md` and `CHANGELOG.md`.

### README.md

1. Plugin name and one-line description
2. Features list
3. Supported editors (home/sch/pcb/footprint)
4. Installation — how to build and import the `.eext` file
5. Usage — how to access the plugin from the menu
6. Configuration — any `extension.json` fields the user should customize
7. Dependencies — npm packages or EDA API modules used
8. Known limitations (if any)

Use the plugin's display language (Chinese or English) matching the user's request language.

### CHANGELOG.md

Follow [Keep a Changelog] format:

```markdown
# Changelog

## [1.0.0] - YYYY-MM-DD
### Added
- Initial release with xxx feature
```

- Record every user-visible change (Added / Changed / Fixed / Removed)
- Use semantic versioning; keep the latest version at the top
- Update CHANGELOG on every code generation or modification session

## Mandatory: EDA API Linter

**Every time you create, modify, or write to a `.ts`, `.js`, or `.html` file, you MUST immediately run the linter on that file before doing anything else.** This is the same level of requirement as running `npm run build` — it is not optional and must not be skipped.

### Command

```bash
# After editing a single file:
node <skill-path>/scripts/lint-eda-api.js <edited-file>

# Or scan the entire project:
node <skill-path>/scripts/lint-eda-api.js .
```

Replace `<skill-path>` with the actual path to this skill directory (e.g., `extension-dev-skill`).

### First-time setup

If `<skill-path>/scripts/api-registry.json` does not exist, build it first:

```bash
node <skill-path>/scripts/build-registry.js
```

### On errors

If the linter reports any `error` level issues:
1. Fix the code immediately
2. Re-run the linter on the same file
3. Repeat until zero errors
4. Only then proceed with the next task

### When to run

| Event | Action |
|-------|--------|
| Created a new `.ts` / `.js` / `.html` file | Run linter on that file |
| Modified an existing `.ts` / `.js` / `.html` file | Run linter on that file |
| Refactored / moved / renamed code | Run linter on the entire project (`.`) |
| Before `npm run build` | Run linter on the entire project (`.`) |

## References

- Quick method signature lookup → `resources/references/_quick-reference.md`
- Master index of all API entities → `resources/references/_index.md`
- Common pitfalls and lessons learned → `resources/experience.md`
- Developer guide (concepts, patterns) → `resources/guide/`
- Full API reference (classes, enums, interfaces, types) → `resources/references/`
