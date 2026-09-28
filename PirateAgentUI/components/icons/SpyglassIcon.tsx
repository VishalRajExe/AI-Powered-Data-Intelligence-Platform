import React from "react";

export function SpyglassIcon({
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
      {/* Spyglass / Telescope angled barrel */}
      {/* Eyepiece */}
      <path d="m4 20 2.5-2.5" />
      <path d="M3.5 17.5 6.5 20.5" />
      {/* Segment 1 */}
      <path d="M6 18l3-3 2 2-3 3z" fill="currentColor" fillOpacity="0.1" />
      {/* Segment 2 */}
      <path d="M8.5 15.5l5-5 2.5 2.5-5 5z" />
      {/* Main objective barrel */}
      <path d="M13 11l6-6 3 3-6 6z" fill="currentColor" fillOpacity="0.15" />
      {/* Lens rim */}
      <path d="M18.5 4.5 22.5 8.5" />
      {/* Ray / focus tick */}
      <path d="M21 3l1-1" strokeDasharray="1 1" />
    </svg>
  );
}
