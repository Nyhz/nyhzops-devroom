import { eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/index';
import { battlefields } from '@/lib/db/schema';
import { getEnvFiles, getEnvFileContents, getEnvExample } from '@/actions/env';
import { EnvEditor } from '@/components/env/env-editor';
import { CreateEnvFile } from '@/components/env/create-env-file';
import { CreateFromExample } from '@/components/env/create-from-example';
import { TacCard } from '@/components/ui/tac-card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PageWrapper } from '@/components/layout/page-wrapper';

export default async function EnvPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [envFiles, exampleVars] = await Promise.all([
    getEnvFiles(id),
    getEnvExample(id),
  ]);

  const fileContents = await Promise.all(
    envFiles.map((f) => getEnvFileContents(id, f.filename)),
  );

  const db = getDatabase();
  const bf = db
    .select({ codename: battlefields.codename })
    .from(battlefields)
    .where(eq(battlefields.id, id))
    .get();

  const hasEnvFiles = envFiles.length > 0;
  const hasExample = exampleVars !== null;

  return (
    <PageWrapper
      breadcrumb={[bf?.codename ?? '', 'ENV']}
      title="ENV"
      actions={<CreateEnvFile battlefieldId={id} />}
      className="space-y-4"
    >
      {!hasEnvFiles && hasExample && (
        <TacCard status="amber" className="space-y-3">
          <p className="text-dr-text font-tactical text-sm tracking-wider">
            A <span className="text-dr-amber">.env.example</span> file was found
            but no <span className="text-dr-amber">.env</span> file exists.
          </p>
          <p className="text-dr-dim text-xs font-tactical tracking-wider">
            Create a .env file to get started, Commander.
          </p>
          <CreateFromExample battlefieldId={id} />
        </TacCard>
      )}

      {!hasEnvFiles && !hasExample && (
        <TacCard status="dim" className="text-center space-y-2 py-8">
          <p className="text-dr-dim font-tactical text-sm tracking-wider">
            No environment files detected.
          </p>
          <p className="text-dr-dim/60 text-xs font-tactical tracking-wider">
            Use CREATE FILE to add a .env file.
          </p>
        </TacCard>
      )}

      {hasEnvFiles && (
        <Tabs defaultValue={envFiles[0].filename}>
          <TabsList
            variant="line"
            className="border-b border-dr-border bg-transparent rounded-none p-0 overflow-x-auto flex-nowrap"
          >
            {envFiles.map((file) => (
              <TabsTrigger
                key={file.filename}
                value={file.filename}
                className="text-dr-muted text-xs font-tactical tracking-wider rounded-none border-none px-4 py-2 data-active:text-dr-amber data-active:bg-transparent hover:text-dr-text"
              >
                {file.filename.toUpperCase()}
                <span className="ml-2 text-dr-dim">({file.varCount})</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {envFiles.map((file, index) => (
            <TabsContent key={file.filename} value={file.filename} className="pt-4">
              <EnvEditor
                battlefieldId={id}
                filename={file.filename}
                initialVariables={fileContents[index]}
                exampleVariables={exampleVars ?? undefined}
                inGitignore={file.inGitignore}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </PageWrapper>
  );
}
