"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const INTEL_QUOTES = [
  "The supreme art of war is to subdue the enemy without fighting. — Sun Tzu",
  "No plan survives first contact with the enemy. — Helmuth von Moltke",
  "In preparing for battle I have always found that plans are useless, but planning is indispensable. — Eisenhower",
  "The more you sweat in training, the less you bleed in combat. — Richard Marcinko",
  "Speed is the essence of war. — Sun Tzu",
  "Who dares wins. — SAS motto",
  "The only easy day was yesterday. — Navy SEALs",
  "Brave men rejoice in adversity, just as brave soldiers triumph in war. — Seneca",
  "Strategy without tactics is the slowest route to victory. Tactics without strategy is the noise before defeat. — Sun Tzu",
  "Fortune favors the bold. — Virgil",
  "Let your plans be dark and impenetrable as night, and when you move, fall like a thunderbolt. — Sun Tzu",
  "Amateurs talk strategy. Professionals talk logistics. — Gen. Omar Bradley",
  "A good plan violently executed now is better than a perfect plan executed next week. — Patton",
  "Victory belongs to the most persevering. — Napoleon",
  "We sleep safely at night because rough men stand ready to visit violence on those who would harm us. — attributed to Orwell",
];

interface RateLimitData {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  lastUpdated: number;
}

export function IntelBar() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [rateLimit, setRateLimit] = useState<RateLimitData | null | undefined>(undefined);

  useEffect(() => {
    // Pick a random starting index on mount
    setIndex(Math.floor(Math.random() * INTEL_QUOTES.length));
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      // Fade out
      setVisible(false);
      // After fade, switch quote and fade in
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % INTEL_QUOTES.length);
        setVisible(true);
      }, 400);
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  // Fetch rate limit status on mount and periodically
  useEffect(() => {
    const fetchRateLimit = async () => {
      try {
        const res = await fetch('/api/logistics/rate-limit');
        const data = await res.json();
        setRateLimit(data);
      } catch {
        // Silently fail — not critical
      }
    };

    fetchRateLimit();
    const interval = setInterval(fetchRateLimit, 30_000);
    return () => clearInterval(interval);
  }, []);

  const rateLimitLabel = (() => {
    if (rateLimit === undefined) return null; // Still loading
    if (rateLimit === null) {
      return { dot: 'text-dr-dim', text: '\u2014', textColor: 'text-dr-dim' };
    }
    if (rateLimit.status === 'allowed') {
      return { dot: 'text-dr-green', text: 'OK', textColor: 'text-dr-green' };
    }
    return { dot: 'text-dr-red', text: 'LIMITED', textColor: 'text-dr-red' };
  })();

  return (
    <header className="bg-dr-surface border-b border-dr-border px-4 py-1.5 flex items-center gap-3 min-h-[32px]">
      <span className="text-dr-amber font-bold text-xs whitespace-nowrap">
        INTEL //
      </span>
      <span
        className="text-dr-dim text-xs truncate transition-opacity duration-300 flex-1"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {INTEL_QUOTES[index]}
      </span>
      {rateLimitLabel && (
        <Link
          href="/logistics"
          className="flex items-center gap-1.5 text-xs whitespace-nowrap hover:opacity-80 transition-opacity"
        >
          <span className="text-dr-dim">LOGISTICS:</span>
          <span className={`text-[8px] ${rateLimitLabel.dot}`}>{'\u25CF'}</span>
          <span className={rateLimitLabel.textColor}>{rateLimitLabel.text}</span>
        </Link>
      )}
    </header>
  );
}
