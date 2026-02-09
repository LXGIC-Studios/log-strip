#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// ── Types ───────────────────────────────────────────────────────────────────

interface CliOptions {
  dirs: string[];
  fix: boolean;
  keep: string[];
  staged: boolean;
  ci: boolean;
  json: boolean;
  help: boolean;
  extensions: string[];
  dryRun: boolean;
  verbose: boolean;
}

interface Match {
  file: string;
  line: number;
  column: number;
  type: string;
  content: string;
}

interface FileResult {
  file: string;
  matches: Match[];
  fixed: boolean;
}

// ── CLI Parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    dirs: [],
    fix: false,
    keep: [],
    staged: false,
    ci: false,
    json: false,
    help: false,
    extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"],
    dryRun: false,
    verbose: false,
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--fix":
      case "-f":
        opts.fix = true;
        break;
      case "--keep":
      case "-k":
        opts.keep = (args[++i] || "").split(",").filter(Boolean);
        break;
      case "--staged":
      case "-s":
        opts.staged = true;
        break;
      case "--ci":
        opts.ci = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--verbose":
      case "-v":
        opts.verbose = true;
        break;
      case "--ext":
      case "-e":
        opts.extensions = (args[++i] || "")
          .split(",")
          .map((e) => (e.startsWith(".") ? e : `.${e}`));
        break;
      default:
        if (!arg.startsWith("-")) {
          opts.dirs.push(arg);
        }
        break;
    }
  }

  if (opts.dirs.length === 0 && !opts.staged) {
    opts.dirs.push(".");
  }

  return opts;
}

// ── Help ────────────────────────────────────────────────────────────────────

function showHelp(): void {
  console.log(`
${c.bold}${c.cyan}log-strip${c.reset} - Find and remove debug statements from your code

${c.bold}USAGE${c.reset}
  ${c.green}log-strip${c.reset} [directories...] [options]

${c.bold}EXAMPLES${c.reset}
  ${c.dim}# Scan current directory for debug statements${c.reset}
  log-strip

  ${c.dim}# Scan and auto-remove them${c.reset}
  log-strip --fix

  ${c.dim}# Keep console.error and console.warn${c.reset}
  log-strip --fix --keep error,warn

  ${c.dim}# Only check git staged files${c.reset}
  log-strip --staged

  ${c.dim}# CI mode (exit 1 if any found)${c.reset}
  log-strip --ci

  ${c.dim}# Scan specific directories${c.reset}
  log-strip src/ lib/

${c.bold}DETECTS${c.reset}
  ${c.yellow}console.log()${c.reset}     ${c.yellow}console.debug()${c.reset}    ${c.yellow}console.info()${c.reset}
  ${c.yellow}console.warn()${c.reset}    ${c.yellow}console.error()${c.reset}    ${c.yellow}console.trace()${c.reset}
  ${c.yellow}console.table()${c.reset}   ${c.yellow}console.dir()${c.reset}      ${c.yellow}console.time()${c.reset}
  ${c.yellow}console.count()${c.reset}   ${c.yellow}console.group()${c.reset}    ${c.yellow}debugger${c.reset}
  ${c.yellow}alert()${c.reset}

${c.bold}OPTIONS${c.reset}
  ${c.yellow}-h, --help${c.reset}            Show this help message
  ${c.yellow}-f, --fix${c.reset}             Auto-remove found statements
  ${c.yellow}-k, --keep <types>${c.reset}    Keep specific console methods (comma-separated)
                        Example: --keep error,warn
  ${c.yellow}-s, --staged${c.reset}          Only check git staged files
  ${c.yellow}--ci${c.reset}                  CI mode: exit code 1 if statements found
  ${c.yellow}--dry-run${c.reset}             Show what --fix would do without changing files
  ${c.yellow}-e, --ext <exts>${c.reset}      File extensions to scan (default: .js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte)
  ${c.yellow}-v, --verbose${c.reset}         Show each match with context
  ${c.yellow}--json${c.reset}                Output results as JSON

${c.bold}EXIT CODES${c.reset}
  ${c.green}0${c.reset}  No debug statements found (or all fixed)
  ${c.red}1${c.reset}  Debug statements found (CI mode)
`);
}

// ── Pattern Matching ────────────────────────────────────────────────────────

const CONSOLE_METHODS = [
  "log",
  "debug",
  "info",
  "warn",
  "error",
  "trace",
  "table",
  "dir",
  "time",
  "timeEnd",
  "timeLog",
  "count",
  "countReset",
  "group",
  "groupEnd",
  "groupCollapsed",
  "clear",
  "assert",
  "profile",
  "profileEnd",
];

function buildPatterns(keep: string[]): RegExp[] {
  const patterns: RegExp[] = [];

  // Console methods (excluding kept ones)
  const methods = CONSOLE_METHODS.filter(
    (m) => !keep.includes(m)
  );

  if (methods.length > 0) {
    // Match console.method( with optional chaining
    patterns.push(
      new RegExp(
        `\\bconsole\\s*\\.\\s*(?:${methods.join("|")})\\s*\\(`,
        "g"
      )
    );
  }

  // debugger statement
  patterns.push(/\bdebugger\b\s*;?/g);

  // alert()
  patterns.push(/\balert\s*\(/g);

  return patterns;
}

function findMatches(content: string, patterns: RegExp[]): Match[] {
  const matches: Match[] = [];
  const lines = content.split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        let type = "unknown";
        const matchStr = match[0];

        if (matchStr.includes("console.")) {
          const methodMatch = matchStr.match(/console\s*\.\s*(\w+)/);
          type = `console.${methodMatch?.[1] || "log"}`;
        } else if (matchStr.includes("debugger")) {
          type = "debugger";
        } else if (matchStr.includes("alert")) {
          type = "alert";
        }

        matches.push({
          file: "",
          line: lineIdx + 1,
          column: match.index + 1,
          type,
          content: line.trim(),
        });
      }
    }
  }

  return matches;
}

// ── Fix (Remove Statements) ────────────────────────────────────────────────

function removeStatements(content: string, patterns: RegExp[]): string {
  const lines = content.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comments
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      result.push(line);
      continue;
    }

    let shouldRemove = false;

    // Check if the entire line is just a debug statement
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        // Check if the line is primarily just this statement
        const cleaned = trimmed
          .replace(/\bconsole\s*\.\s*\w+\s*\([^)]*\)\s*;?\s*/g, "")
          .replace(/\bdebugger\b\s*;?\s*/g, "")
          .replace(/\balert\s*\([^)]*\)\s*;?\s*/g, "")
          .trim();

        if (!cleaned) {
          shouldRemove = true;
          break;
        }
      }
    }

    // Handle multi-line console statements
    if (!shouldRemove && patterns.some((p) => { p.lastIndex = 0; return p.test(trimmed); })) {
      // Check for multi-line: if line has opening paren but not matching close
      const openParens = (line.match(/\(/g) || []).length;
      const closeParens = (line.match(/\)/g) || []).length;

      if (openParens > closeParens) {
        // Skip lines until we find the matching close paren
        let depth = openParens - closeParens;
        shouldRemove = true;
        while (depth > 0 && i + 1 < lines.length) {
          i++;
          const nextLine = lines[i];
          depth += (nextLine.match(/\(/g) || []).length;
          depth -= (nextLine.match(/\)/g) || []).length;
        }
        // Skip the semicolon line if next line is just ;
        if (i + 1 < lines.length && lines[i + 1].trim() === ";") {
          i++;
        }
      } else {
        shouldRemove = true;
      }
    }

    if (!shouldRemove) {
      result.push(line);
    }
  }

  // Remove consecutive blank lines (cleanup after removal)
  const final: string[] = [];
  for (let i = 0; i < result.length; i++) {
    if (i > 0 && result[i].trim() === "" && result[i - 1].trim() === "") {
      continue;
    }
    final.push(result[i]);
  }

  return final.join("\n");
}

// ── File Walking ────────────────────────────────────────────────────────────

function walkFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];

  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "coverage",
    ".cache",
    ".output",
    "vendor",
    "__pycache__",
    ".venv",
    "target",
  ]);

  function walk(directory: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;

      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return results;
}

function getStagedFiles(extensions: string[]): string[] {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      encoding: "utf-8",
      timeout: 10000,
    });

    return output
      .trim()
      .split("\n")
      .filter((f) => {
        if (!f) return false;
        const ext = path.extname(f);
        return extensions.includes(ext);
      })
      .map((f) => path.resolve(f));
  } catch {
    return [];
  }
}

// ── Display ─────────────────────────────────────────────────────────────────

function typeIcon(type: string): string {
  if (type.startsWith("console.")) return `${c.yellow}⚡${c.reset}`;
  if (type === "debugger") return `${c.red}🔴${c.reset}`;
  if (type === "alert") return `${c.magenta}🔔${c.reset}`;
  return `${c.dim}?${c.reset}`;
}

function displayResults(results: FileResult[], opts: CliOptions): void {
  let totalMatches = 0;
  let totalFiles = 0;

  for (const result of results) {
    if (result.matches.length === 0) continue;
    totalFiles++;
    totalMatches += result.matches.length;

    const relPath = path.relative(process.cwd(), result.file);
    console.log(
      `\n  ${c.cyan}${c.bold}${relPath}${c.reset} ${c.dim}(${result.matches.length} match${result.matches.length !== 1 ? "es" : ""})${c.reset}`
    );

    for (const match of result.matches) {
      const icon = typeIcon(match.type);
      console.log(
        `    ${icon} ${c.dim}L${match.line}:${match.column}${c.reset}  ${c.yellow}${match.type}${c.reset}`
      );
      if (opts.verbose) {
        console.log(
          `      ${c.dim}${match.content.substring(0, 80)}${match.content.length > 80 ? "..." : ""}${c.reset}`
        );
      }
    }
  }

  // Summary
  console.log("");
  if (totalMatches === 0) {
    console.log(
      `  ${c.green}${c.bold}✓${c.reset} No debug statements found. Your code is clean!\n`
    );
  } else {
    const action = opts.fix
      ? opts.dryRun
        ? "would be removed"
        : "removed"
      : "found";
    console.log(
      `  ${c.yellow}${c.bold}${totalMatches}${c.reset} statement${totalMatches !== 1 ? "s" : ""} ${action} across ${c.bold}${totalFiles}${c.reset} file${totalFiles !== 1 ? "s" : ""}\n`
    );

    if (!opts.fix && !opts.ci) {
      console.log(
        `  ${c.dim}Run with ${c.cyan}--fix${c.dim} to auto-remove, or ${c.cyan}--fix --keep error,warn${c.dim} to preserve those.${c.reset}\n`
      );
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  if (!opts.json) {
    console.log(
      `\n${c.bold}${c.magenta}🧹 Log Strip${c.reset}${c.dim} - Find debug statements in your code${c.reset}`
    );
    if (opts.keep.length > 0) {
      console.log(
        `  ${c.dim}Keeping: ${opts.keep.map((k) => `console.${k}`).join(", ")}${c.reset}`
      );
    }
  }

  // Get files to scan
  let files: string[];
  if (opts.staged) {
    files = getStagedFiles(opts.extensions);
    if (!opts.json) {
      console.log(
        `  ${c.dim}Scanning ${files.length} staged file${files.length !== 1 ? "s" : ""}...${c.reset}`
      );
    }
  } else {
    files = [];
    for (const dir of opts.dirs) {
      const resolved = path.resolve(dir);
      const stat = fs.statSync(resolved, { throwIfNoEntry: false });
      if (stat?.isFile()) {
        files.push(resolved);
      } else if (stat?.isDirectory()) {
        files.push(...walkFiles(resolved, opts.extensions));
      }
    }
    if (!opts.json) {
      console.log(
        `  ${c.dim}Scanning ${files.length} file${files.length !== 1 ? "s" : ""}...${c.reset}`
      );
    }
  }

  const patterns = buildPatterns(opts.keep);
  const results: FileResult[] = [];
  let totalMatches = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const matches = findMatches(content, patterns);

      // Set file path on matches
      matches.forEach((m) => (m.file = file));

      const result: FileResult = { file, matches, fixed: false };

      if (matches.length > 0 && opts.fix && !opts.dryRun) {
        const fixed = removeStatements(content, patterns);
        fs.writeFileSync(file, fixed);
        result.fixed = true;
      }

      if (matches.length > 0) {
        results.push(result);
        totalMatches += matches.length;
      }
    } catch {
      // Skip files we can't read
    }
  }

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          total: totalMatches,
          files: results.map((r) => ({
            file: path.relative(process.cwd(), r.file),
            matches: r.matches.map((m) => ({
              line: m.line,
              column: m.column,
              type: m.type,
              content: m.content,
            })),
            fixed: r.fixed,
          })),
        },
        null,
        2
      )
    );
  } else {
    displayResults(results, opts);
  }

  if (opts.ci && totalMatches > 0) {
    process.exit(1);
  }
}

main();
