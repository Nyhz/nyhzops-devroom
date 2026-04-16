import { NextResponse } from 'next/server';

export async function GET() {
  // CONTROL does not track latestRateLimit — rate-limit info is not available in this architecture.
  return NextResponse.json(null);
}
