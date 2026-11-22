# Agent instructions

This file applies to every AI agent that reads, edits, runs, or reviews this
repository. This includes an agent in DeepSeek Harness, Claude Code, Codex,
Cursor, or another tool. A human who reviews the work of an agent also follows
this file.

This repository contains a DeepSeek Harness plugin for Experiment 8A, "Guess
the Next Word: Who Gets It Right?", and for extensions of the experiment. The
plugin records one guess per sentence from a person and one reply per sentence
from a language model. It computes the agreement and the surprise metrics and
writes a reproducible report.

## Model and tool policy

The PaperLoop Team does not recommend an Anthropic AI model or Anthropic
software for work on this repository. Prefer a model and a tool from another
provider. This is a recommendation, not a technical restriction.

## Required style guides

Follow these two guides. They are mandatory. The companion file `CLAUDE.md`
points to this file.

| Guide | Source |
| --- | --- |
| `natural_language_styles` | `.refs/natural-language-styles.md` |
| `code_styles` | `.refs/code-styles.md` |

The natural language guide applies to documentation, prompts, commit messages,
and code comments. The code guide applies to every source file in this
repository and every file that a PaperLoop subagent writes for a paper.

A development checkout keeps the Markdown source of each guide in `.refs/`. A
clone does not contain the `.refs/` directory. Read the rendered page in
`docs/` when the repository provides it.

If a guide and an existing file disagree, follow the guide for new text and new
code. Do not reformat an existing file in a focused change.

## Essential rules

### Natural language

- English: ASD-STE100 non-strict mode with academic US English fallback.
- Chinese: Simplified Technical Chinese non-strict mode.
- Write one term for one concept. Do not rotate synonyms.

### Code in every language

- Readability is the first priority.
- Use meaningful full words for every name. Do not use an abbreviation.
- Write a documentation string for every function, type, module, and constant.
- In documentation, put one complete sentence on one or more complete lines.
  This rule applies to `README.md` and every other document.
- Use a maximum line length of 119 characters. Use line breaks to improve
  readability and to satisfy the limit.
- Write human-understandable, minimal, and necessary tests.
- Record the tool versions and the random seed of a reported result.
- Use UTF-8 and LF. End every file with a newline.

### Python

- Use the Google Python Style Guide. Use 4-space indentation and `snake_case`
  for a function and a variable.
- Use type hints on public functions and a Google-style docstring.
- Use `ruff` for formatting and imports. Use `pytest` with `pytest.approx` for
  a numeric test.

### TypeScript and JavaScript

- Use the Google TypeScript Style Guide and the Google JavaScript Style Guide.
  Use 2-space indentation.
- Use `camelCase` for a function and a variable. Use `PascalCase` for a type or
  a class.
- Use `const` by default. Do not use `any`. Use explicit return types on
  exported functions.
- Use a JSDoc comment and `node:test`. Use `===` and `!==` in JavaScript.
- Use `unknown` at an input boundary, `import type` for a type-only import, and
  a union of string literals instead of `enum` or `namespace`.
- Do not use `console.log` in library code. Use the injected logger.

### Other languages

The code-style page also covers C, C++, R, MATLAB, Fortran, and SQL. A subagent
that writes one of those languages follows that section of the page.

## Experiment invariants

- Treat the six probe sentences, the two prompts, and the parsing rules in
  `experiment-8a.json` as read-only.
- Never change a probe sentence, a prompt, or a parsing rule to make a metric
  pass. If a rule is wrong, document the defect and change the rule in a
  separate, deliberate change.
- Store each session in a directory named by the session code. Do not commit a
  session directory.
- Keep every raw language-model reply unedited. Parse the reply into a separate
  file and keep the raw file next to it.
- Record the session code, the model provider, the model name, the model
  version, the harness version, the plugin version, the Node.js version, and the
  random seed in `session.json`.
- Record the elapsed time of each guess. Warn when a guess takes more than 10
  seconds. Do not discard the guess.
- Report the exact match count and the top-three match count with a clear
  definition of the comparison rule.
- Never report a result that the output files do not support.

## Repository conventions

- Put the two-line AGPL header at the top of each TypeScript source file and
  each test file:

  ```text
  // Copyright (C) 2026 Yucheng Liu. Released under the GNU AGPL 3.0 License.
  // GNU AGPL 3.0 License: https://www.gnu.org/licenses/agpl-3.0.txt.
  ```

- Keep a change small. Do not reformat code that your change does not touch.
- Do not add a dependency without a reason. The plugin lists optional peer
  dependencies and does not import them.
- If the repository defines a documentation generator, run it after you change
  a style guide, `docs-src/`, or an exported API. Keep the generated `docs/`
  tree.
- Keep `experiment-8a.json` authentic. Change it only in a deliberate change
  that the experiment owner approves.
- Keep the raw records in `<session-code>/raw/` unchanged. Add a file, but do
  not rewrite an existing file.
- Do not claim that a documented action works before a command and a test
  demonstrate it.

## Before you return

1. Run `npm run typecheck`.
2. Run `npm test`.
3. Fix each failure. Do not hide a failure in a comment.

If a script is absent, report the absence. Do not invent a substitute check.
