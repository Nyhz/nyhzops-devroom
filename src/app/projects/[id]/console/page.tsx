export default async function ConsolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-dr-amber text-sm font-tactical tracking-wider mb-2">
          CLASSIFIED
        </div>
        <div className="text-dr-dim text-xs font-tactical">
          This section is under development — Phase D
        </div>
      </div>
    </div>
  );
}
