/**
 * Filter a flag and its value from a CLI args array.
 * E.g., filterFlag(['--max-turns', '5', '--model', 'x'], '--max-turns') => ['--model', 'x']
 */
export function filterFlag(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) { i++; continue; }
    result.push(args[i]);
  }
  return result;
}

/**
 * Filter multiple flags and their values from a CLI args array.
 */
export function filterFlags(args: string[], flags: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flags.includes(args[i])) { i++; continue; }
    result.push(args[i]);
  }
  return result;
}
