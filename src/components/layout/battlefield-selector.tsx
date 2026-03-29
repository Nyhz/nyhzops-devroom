"use client";

import { useRouter, usePathname } from "next/navigation";
import type { Battlefield } from "@/types";
import {
  TacSelect,
  TacSelectTrigger,
  TacSelectContent,
  TacSelectItem,
  TacSelectValue,
} from "@/components/ui/tac-select";

interface BattlefieldSelectorProps {
  battlefields: Battlefield[];
}

export function BattlefieldSelector({ battlefields }: BattlefieldSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Extract current battlefield ID from URL: /battlefields/[id]/...
  const segments = pathname.split("/");
  const projectsIndex = segments.indexOf("projects");
  const currentId = projectsIndex >= 0 ? segments[projectsIndex + 1] : undefined;

  if (battlefields.length === 0) {
    return (
      <div className="text-dr-muted text-sm px-1 py-1">No battlefields</div>
    );
  }

  return (
    <TacSelect
      value={currentId ?? ""}
      onValueChange={(id) => router.push(`/battlefields/${id}`)}
    >
      <TacSelectTrigger className="w-full text-sm h-9">
        <TacSelectValue placeholder="Select battlefield" />
      </TacSelectTrigger>
      <TacSelectContent>
        {battlefields.map((bf) => (
          <TacSelectItem key={bf.id} value={bf.id} className="text-sm">
            {bf.codename}
          </TacSelectItem>
        ))}
      </TacSelectContent>
    </TacSelect>
  );
}
