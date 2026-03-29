"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SidebarContent } from "./sidebar-content";
import type { Battlefield } from "@/types";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  battlefields: Battlefield[];
  missionCounts: Record<string, number>;
  campaignCounts: Record<string, number>;
}

export function MobileDrawer({
  open,
  onClose,
  battlefields,
  missionCounts,
  campaignCounts,
}: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  // Auto-close on pathname change
  useEffect(() => {
    if (prevPathnameRef.current !== pathname && open) {
      onClose();
    }
    prevPathnameRef.current = pathname;
  }, [pathname, open, onClose]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open || !drawerRef.current) return;

    const drawer = drawerRef.current;
    const focusableSelector =
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';

    // Focus the drawer panel itself on open
    drawer.focus();

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;

      const focusableElements = drawer.querySelectorAll(focusableSelector);
      if (focusableElements.length === 0) return;

      const first = focusableElements[0] as HTMLElement;
      const last = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === drawer) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-200 ease-out",
          open ? "opacity-100" : "opacity-0"
        )}
        onClick={handleBackdropClick}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation drawer"
        className={cn(
          "absolute top-0 left-0 h-full w-[280px] bg-dr-surface border-r border-dr-border",
          "flex flex-col overflow-y-auto outline-none",
          "transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent
          battlefields={battlefields}
          missionCounts={missionCounts}
          campaignCounts={campaignCounts}
          onLinkClick={onClose}
        />
      </div>
    </div>
  );
}
