"use client";
import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, duration = 400) {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    startRef.current = null;

    let raf: number;
    function step(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(1, elapsed / duration);
      setDisplay(Math.round(from + (target - from) * progress));
      if (progress < 1) raf = requestAnimationFrame(step);
      else fromRef.current = target;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return display;
}
