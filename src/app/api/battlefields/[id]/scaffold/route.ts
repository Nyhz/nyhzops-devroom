import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { runCommand } from '@/lib/process/command-runner';
import simpleGit from 'simple-git';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDatabase();

  const battlefield = db.select().from(battlefields).where(eq(battlefields.id, id)).get();
  if (!battlefield || !battlefield.scaffoldCommand) {
    return NextResponse.json({ error: 'No scaffold command' }, { status: 400 });
  }

  // Mark scaffold as running
  db.update(battlefields)
    .set({ scaffoldStatus: 'running', updatedAt: Date.now() })
    .where(eq(battlefields.id, id))
    .run();

  try {
    const result = await runCommand({
      command: battlefield.scaffoldCommand,
      cwd: battlefield.repoPath,
      socketRoom: `console:${id}`,
      battlefieldId: id,
    });

    if (result.exitCode === 0) {
      // Git add + commit the scaffold output
      const git = simpleGit(battlefield.repoPath);
      await git.add('-A');
      await git.commit('Initial scaffold');

      db.update(battlefields)
        .set({ scaffoldStatus: 'complete', updatedAt: Date.now() })
        .where(eq(battlefields.id, id))
        .run();
    } else {
      db.update(battlefields)
        .set({ scaffoldStatus: 'failed', updatedAt: Date.now() })
        .where(eq(battlefields.id, id))
        .run();
    }

    return NextResponse.json({ success: result.exitCode === 0, exitCode: result.exitCode });
  } catch (err) {
    db.update(battlefields)
      .set({ scaffoldStatus: 'failed', updatedAt: Date.now() })
      .where(eq(battlefields.id, id))
      .run();
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
