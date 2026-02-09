# @lxgicstudios/log-strip

[![npm version](https://img.shields.io/npm/v/@lxgicstudios/log-strip.svg)](https://www.npmjs.com/package/@lxgicstudios/log-strip)
[![license](https://img.shields.io/npm/l/@lxgicstudios/log-strip.svg)](https://github.com/lxgicstudios/log-strip/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/@lxgicstudios/log-strip.svg)](https://nodejs.org)

Find and remove console.log, console.debug, debugger, and alert() statements from your codebase. Perfect for pre-commit hooks and CI pipelines.

Zero external dependencies.

## Install

```bash
npm install -g @lxgicstudios/log-strip
```

Or run it directly:

```bash
npx @lxgicstudios/log-strip
```

## Usage

```bash
# Scan current directory
log-strip

# Auto-remove all debug statements
log-strip --fix

# Keep console.error and console.warn
log-strip --fix --keep error,warn

# Only check git staged files (great for pre-commit hooks)
log-strip --staged

# CI mode - exits with code 1 if any found
log-strip --ci

# Scan specific directories
log-strip src/ lib/

# Preview what --fix would do
log-strip --fix --dry-run

# Show full line content for each match
log-strip --verbose

# JSON output
log-strip --json
```

## What It Detects

- `console.log()`, `console.debug()`, `console.info()`
- `console.warn()`, `console.error()`, `console.trace()`
- `console.table()`, `console.dir()`, `console.time()`
- `console.count()`, `console.group()`, and all other console methods
- `debugger` statements
- `alert()` calls

## Features

- Scans JS, TS, JSX, TSX, Vue, Svelte files
- Auto-fix mode to remove statements
- Keep specific console methods (e.g., error, warn)
- Git staged files mode for pre-commit hooks
- CI mode with non-zero exit codes
- Dry-run mode to preview changes
- Skips comments (won't flag commented-out logs)
- Handles multi-line console statements
- Custom file extension support
- JSON output for tooling integration
- Zero external dependencies

## Pre-commit Hook

Add to your package.json:

```json
{
  "scripts": {
    "precommit": "log-strip --staged --ci --keep error,warn"
  }
}
```

Or with husky:

```bash
npx husky add .husky/pre-commit "npx @lxgicstudios/log-strip --staged --ci --keep error,warn"
```

## Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--help` | `-h` | Show help message | |
| `--fix` | `-f` | Auto-remove debug statements | `false` |
| `--keep <types>` | `-k` | Keep specific console methods | |
| `--staged` | `-s` | Only check git staged files | `false` |
| `--ci` | | Exit code 1 if statements found | `false` |
| `--dry-run` | | Preview what --fix would do | `false` |
| `--ext <exts>` | `-e` | File extensions to scan | `.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte` |
| `--verbose` | `-v` | Show line content for each match | `false` |
| `--json` | | Output as JSON | `false` |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | No debug statements found (or all fixed) |
| `1` | Debug statements found (CI mode) |

## License

MIT - [LXGIC Studios](https://github.com/lxgicstudios)
