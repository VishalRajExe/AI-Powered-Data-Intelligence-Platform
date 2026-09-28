import React from "react";

export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center shrink-0 rounded-lg bg-primary text-primary-foreground shadow-subtle ${className}`}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
      >
        <circle cx="12" cy="5" r="2.5" />
        <line x1="12" y1="21" x2="12" y2="7.5" />
        <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
        <line x1="6.5" y1="9.5" x2="17.5" y2="9.5" strokeWidth="2.2" />
      </svg>
    </div>
  );
}
