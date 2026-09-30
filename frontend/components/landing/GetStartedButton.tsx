"use client";

import Link from "next/link";

interface GetStartedButtonProps {
  size?: "default" | "nav";
  className?: string;
}

export function GetStartedButton({ size = "default", className = "" }: GetStartedButtonProps) {
  return (
    <Link
      // Registration is real now: a new account creates its own workspace and signs in on success.
      href="/signup"
      id="get-started-cta"
      className={`pirate-button ${size === "nav" ? "pirate-button--nav" : ""} ${className}`}
      aria-label="Get Started with PirateAgent"
    >
      <span className="pirate-button__inner">
        <span className="pirate-button__text">GET STARTED</span>
      </span>
    </Link>
  );
}
