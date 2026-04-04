"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Battlefield } from "@/types";

interface BattlefieldSelectorProps {
  battlefields: Battlefield[];
}

export function BattlefieldSelector({ battlefields }: BattlefieldSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract current battlefield ID from URL: /battlefields/[id]/...
  const segments = pathname.split("/");
  const bfIndex = segments.indexOf("battlefields");
  const currentId = bfIndex >= 0 ? segments[bfIndex + 1] : undefined;

  const currentBattlefield = battlefields.find((bf) => bf.id === currentId);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close dropdown on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (battlefields.length === 0) {
    return (
      <div className="text-dr-muted text-sm px-1 py-1">No battlefields</div>
    );
  }

  function handleSelect(id: string) {
    setOpen(false);
    router.push(`/battlefields/${id}`);
  }

  return (
    <div ref={containerRef}>
      <div className="flex items-center gap-1.5">
        {/* Select trigger */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 text-sm",
            "bg-dr-elevated border border-dr-border rounded",
            "hover:border-dr-dim transition-colors",
            open && "border-dr-dim rounded-b-none"
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {currentBattlefield && (
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  currentBattlefield.status === "archived" ? "bg-dr-dim" : "bg-dr-green"
                )}
              />
            )}
            <span className="font-bold text-dr-text truncate">
              {currentBattlefield?.codename ?? "Select battlefield"}
            </span>
          </span>
          <span className="text-dr-dim text-[10px] shrink-0">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* Gear button — config */}
        {currentId && (
          <Link
            href={`/battlefields/${currentId}/config`}
            className={cn(
              "shrink-0 w-[34px] h-[34px] flex items-center justify-center",
              "bg-dr-elevated border border-dr-border rounded",
              "text-dr-dim hover:text-dr-amber hover:border-dr-amber transition-colors"
            )}
            title="Battlefield Config"
          >
            ⚙
          </Link>
        )}
      </div>

      {/* Dropdown */}
      {open && (
        <div
          className="bg-dr-elevated border border-dr-border border-t-0 rounded-b overflow-hidden"
          style={{ marginRight: currentId ? "calc(34px + 0.375rem)" : "0" }}
        >
          {battlefields.map((bf) => (
            <button
              key={bf.id}
              type="button"
              onClick={() => handleSelect(bf.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors",
                bf.id === currentId
                  ? "text-dr-amber"
                  : "text-dr-muted hover:text-dr-text hover:bg-dr-surface"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  bf.status === "archived" ? "bg-dr-dim" : "bg-dr-green"
                )}
              />
              <span className="truncate">{bf.codename}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
