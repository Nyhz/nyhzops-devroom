/**
 * Curated testing-framework table used by bootstrap when a battlefield lacks
 * detected `test` / `build` gates (spec §12 "Curated testing frameworks").
 *
 * Each entry supplies:
 *   - the canonical `testCommand` CONTROL will run to verify green,
 *   - a natural-language `installBriefing` passed to INTEL so it can install
 *     the framework, wire scripts, and author a smoke test.
 *
 * For languages with no single universal default (e.g. Java/Kotlin — Maven vs
 * Gradle), the entry picks one mainstream choice and the briefing documents
 * the choice explicitly so INTEL can adapt if the repo already uses the other.
 */

export type LanguageKey = 'ts' | 'py' | 'go' | 'rust' | 'ruby' | 'java' | 'csharp';

export interface FrameworkConfig {
  language: LanguageKey;
  /** Canonical command CONTROL runs to verify the framework is installed and
   *  exits 0 on a green smoke test. */
  testCommand: string;
  /** Briefing passed verbatim to INTEL when asked to scaffold this framework. */
  installBriefing: string;
}

export const FRAMEWORKS: Record<LanguageKey, FrameworkConfig> = {
  ts: {
    language: 'ts',
    testCommand: 'pnpm test',
    installBriefing: [
      'Install Vitest as a devDependency using pnpm.',
      'Add a minimal smoke test under `src/` (e.g. `src/smoke.test.ts`) that asserts a trivial truth.',
      'Wire a `test` script in `package.json` that invokes `vitest run`.',
      'Ensure `pnpm test` exits 0.',
      'Commit all changes.',
    ].join('\n'),
  },
  py: {
    language: 'py',
    testCommand: 'pytest',
    installBriefing: [
      'Install pytest using the project\'s package manager (pip / poetry / uv as appropriate).',
      'Create `tests/test_smoke.py` with a minimal passing assertion.',
      'Ensure `pytest` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
  go: {
    language: 'go',
    testCommand: 'go test ./...',
    installBriefing: [
      'Add a minimal smoke test using the Go stdlib `testing` package (e.g. `smoke_test.go`).',
      'No extra dependencies are required — `go test` is part of the standard toolchain.',
      'Ensure `go test ./...` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
  rust: {
    language: 'rust',
    testCommand: 'cargo test',
    installBriefing: [
      'Add a minimal smoke test using the Rust stdlib `#[test]` macro (e.g. at the bottom of `src/lib.rs`).',
      'No extra dependencies are required — `cargo test` is part of the standard toolchain.',
      'Ensure `cargo test` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
  ruby: {
    language: 'ruby',
    testCommand: 'rspec',
    installBriefing: [
      'Add RSpec to the project Gemfile and run `bundle install` (or `gem install rspec` if no Gemfile exists).',
      'Run `rspec --init` to scaffold `.rspec` and `spec/spec_helper.rb` if not already present.',
      'Create `spec/smoke_spec.rb` with a minimal passing example.',
      'Ensure `rspec` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
  java: {
    // Maven chosen over Gradle as the default: pom.xml is simpler to author
    // and Maven's build lifecycle auto-invokes tests under `mvn test`. INTEL
    // may override to Gradle (`gradle test`) if the repo already ships
    // `build.gradle` — the briefing documents this.
    language: 'java',
    testCommand: 'mvn test',
    installBriefing: [
      'Add JUnit 5 (JUnit Jupiter) as a test dependency.',
      'If the repo already uses Gradle (`build.gradle` present), wire up `gradle test` instead and report the chosen command in your debrief.',
      'Otherwise use Maven: ensure `pom.xml` declares `junit-jupiter` in test scope and `maven-surefire-plugin` is configured for JUnit 5.',
      'Create a minimal smoke test under `src/test/java/smoke/SmokeTest.java` with `@Test void smoke()`.',
      'Ensure `mvn test` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
  csharp: {
    language: 'csharp',
    testCommand: 'dotnet test',
    installBriefing: [
      'Create a new xUnit test project (e.g. `dotnet new xunit -o tests/Smoke.Tests`) and reference the main project if one exists.',
      'Author a minimal passing `[Fact]` in `Smoke.Tests/SmokeTest.cs`.',
      'If the solution has a `.sln`, add the test project to it (`dotnet sln add`).',
      'Ensure `dotnet test` exits 0 from the repo root.',
      'Commit all changes.',
    ].join('\n'),
  },
};
