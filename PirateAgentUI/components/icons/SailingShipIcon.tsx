import React from "react";

export function SailingShipIcon({
  className = "h-8 w-8",
  strokeWidth = 1.75,
  ...props
}: React.SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* Ocean waves */}
      <path d="M4 39c4-1.5 8-1.5 12 0s8 1.5 12 0 8-1.5 12 0 3-0.5 4-1" />
      <path d="M8 43c4-1.5 8-1.5 12 0s8 1.5 12 0 8-1.5 12 0" opacity="0.6" strokeDasharray="3 3" />
      
      {/* Ship Hull */}
      <path
        d="M8 35c2 3 7 4 16 4s15-1 18-5l-4-4H10l-2 5Z"
        fill="currentColor"
        fillOpacity="0.12"
      />
      
      {/* Mast */}
      <line x1="24" y1="9" x2="24" y2="30" strokeWidth={2} />
      
      {/* Main billowing sail */}
      <path
        d="M24 11c7 0 13 4 13 11-4-1-9-1-13 0"
        fill="currentColor"
        fillOpacity="0.18"
      />
      
      {/* Jib / Fore sail */}
      <path
        d="M22 13c-5 2-9 6-10 11 3-1 7-1 10 0"
        fill="currentColor"
        fillOpacity="0.12"
      />
      
      {/* Pirate / Captain pennant flag */}
      <path d="M24 8l6-3-6-3v6Z" fill="currentColor" />
    </svg>
  );
}
