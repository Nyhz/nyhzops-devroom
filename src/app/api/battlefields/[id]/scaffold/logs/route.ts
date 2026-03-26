import { NextRequest, NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields, commandLogs } from '@/lib/db/schema';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, id)).get();
  if (!battlefield?.scaffoldCommand) {
    return NextResponse.json({ logs: '' });
  }

  const log = db.select()
    .from(commandLogs)
    .where(and(
      eq(commandLogs.battlefieldId, id),
      eq(commandLogs.command, battlefield.scaffoldCommand)
    ))
    .orderBy(desc(commandLogs.createdAt))
    .limit(1)
    .get();

  return NextResponse.json({
    logs: log?.output || '',
    exitCode: log?.exitCode ?? null,
    isComplete: battlefield.scaffoldStatus === 'complete' || battlefield.scaffoldStatus === 'failed',
  });
}
