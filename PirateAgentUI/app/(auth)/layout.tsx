import { Logo } from "@/components/common/logo";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex h-16 items-center px-6 md:px-10 border-b border-border/60 bg-surface/50">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo className="h-7 w-7 transition-transform group-hover:scale-105" />
          <span className="font-serif text-[16px] font-bold tracking-wider text-foreground">PIRATEAGENT</span>
        </Link>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">{children}</div>
    </div>
  );
}
