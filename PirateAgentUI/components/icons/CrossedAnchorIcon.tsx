import React from "react";

export function CrossedAnchorIcon({
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
      <circle cx="12" cy="5" r="2.5" />
      <line x1="12" y1="21" x2="12" y2="7.5" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
      <line x1="6" y1="9.5" x2="18" y2="9.5" />
      {/* Discreet cross mark */}
      <line x1="9.5" y1="13.5" x2="14.5" y2="18.5" strokeWidth={2.2} />
      <line x1="14.5" y1="13.5" x2="9.5" y2="18.5" strokeWidth={2.2} />
    </svg>
  );
}
