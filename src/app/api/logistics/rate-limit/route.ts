import { NextResponse } from 'next/server';

export async function GET() {
  const rl = globalThis.orchestrator?.latestRateLimit ?? null;
  return NextResponse.json(rl);
}
