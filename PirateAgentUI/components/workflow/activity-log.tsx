"use client";
import { AnimatePresence, motion } from "framer-motion";
import { formatRelativeTime } from "@/lib/utils";

export function ActivityLog({ items }: { items: { id: string; text: string; timestamp: string }[] }) {
  return (
    <div className="scrollbar-thin max-h-64 space-y-2.5 overflow-y-auto pr-1">
      <AnimatePresence initial={false}>
        {[...items].reverse().map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start justify-between gap-3 border-b border-border/60 pb-2.5 last:border-0"
          >
            <p className="text-[13px] text-foreground/90">{item.text}</p>
            <span className="shrink-0 text-[11.5px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
