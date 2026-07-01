# Changelog

All notable changes to `qa-intelligence` are documented here.

## Unreleased

### Added

- Unit tests for `computeDiff`, `failureIdentity`, `format`, and `history`
- `npm test` script (Node built-in test runner via `tsx`)
- Extracted history logic into `src/lib/history.ts`
- GitHub Actions CI: test, build, and fixture-based diff CLI smoke test
- Fixture artifact directories for CLI validation

## 1.1.2

### Fixed

- PR comment now clarifies that pre-existing failures do not block merge

## 1.1.1

### Fixed

- More accurate PR diff grouping for failure keys
