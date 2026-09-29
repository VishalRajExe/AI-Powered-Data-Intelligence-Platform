import React from "react";

export function TreasureChestIcon({
  className = "h-4 w-4",
  strokeWidth = 2,
  ...props
}: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Curved chest lid */}
      <path d="M3 10V8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2" fill="currentColor" fillOpacity="0.08" />
      <path d="M2 10h20" />
      {/* Chest body */}
      <rect x="3" y="10" width="18" height="10" rx="1.5" />
      {/* Keyhole clasp */}
      <rect x="10.5" y="9" width="3" height="4" rx="0.5" fill="currentColor" />
      <circle cx="12" cy="11" r="0.5" fill="var(--background, #E8DFCF)" />
    </svg>
  );
}
