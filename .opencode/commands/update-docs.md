---
description: Audit and update all documentation to reflect current codebase state
agent: build
---

## Approach

This command audits and updates documentation to ensure accuracy. It produces point-in-time snapshots, not evolutionary commentary.

## Steps

### 1. Read Existing Documentation

Read all files in `docs/` directory to understand current state:
```
docs/*.md
```

Note the last update dates and which components are documented.

### 2. Explore Codebase for Changes

Search broadly across the codebase for features/config that may need documentation:

- **Config schemas**: `src/config/schemas/**/*.ts` - all environment variables
- **Services**: `src/domain/`, `src/engine/` - core business logic
- **Adapters**: `src/adapters/` - external integrations (Discord, Polymarket, etc.)
- **Strategies**: `src/engine/strategies/` - trading strategies
- **Validation**: `src/engine/validation/` - signal validation
- **Execution**: `src/domain/execution/` - trade execution

Look for:
- New files or modules
- New environment variables in config schemas
- New notification types
- New API integrations
- Modified or new risk checks

### 3. Audit Against Documentation

For each doc file, verify:

| Doc File | Check |
|----------|-------|
| STRATEGY.md | Do strategy names, file paths, parameters match actual code? |
| RISK_MANAGEMENT.md | Are all risk checks, params, and defaults current? |
| NOTIFICATIONS.md | Are all notification functions and events listed? |
| README.md | Does Features section match implementation? |

### 4. Update Documentation

Update files to reflect current state:

**README.md**:
- Keep high-level overview
- Update Features list to match actual capabilities
- Add new sections for features not covered elsewhere

**docs/*.md**:
- Rewrite sections that are outdated (don't append "changed" notes)
- Use tables for configuration options and parameters
- Include file path references to source code
- Remove version history - keep only current state

**Tone**: Technical, concise, practical - what users need to configure and operate

**Formatting**:
- Tables for configuration options
- Tables for notification types/events
- Code examples for setup
- File path references in format `src/path/to/file.ts`

### 5. Commit

Create a single commit for documentation updates:
```
docs: Update documentation to reflect current codebase
```

