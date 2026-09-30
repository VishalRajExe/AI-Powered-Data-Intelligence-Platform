"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { AnchorIcon } from "@/components/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api/client";

export default function SignupPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    const displayName = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      await register({ email, password, displayName });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[380px] animate-fade-in">
      <Card className="border-border bg-card shadow-card p-0">
        <CardContent className="p-7">
          <div className="mb-6 flex flex-col items-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface border border-border text-tan shadow-xs">
              <AnchorIcon className="h-5 w-5" />
            </div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">Create your account</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Chart your course with PirateAgent intelligence</p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-danger-soft border border-danger/20 p-3 text-[12.5px] text-danger font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Full name</Label>
              <Input id="name" name="name" placeholder="Your name" required className="bg-surface/50 border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email</Label>
              <Input id="email" name="email" type="email" placeholder="you@company.com" required className="bg-surface/50 border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="12 to 72 characters"
                minLength={12}
                maxLength={72}
                required
                className="bg-surface/50 border-border text-foreground"
              />
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Length is the only rule the server enforces, and it is its own: 12 is bcrypt&apos;s floor
                and 72 is where it silently stops reading.
              </p>
            </div>
            <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary-hover font-semibold mt-2" loading={loading}>
              {!loading && (
                <>
                  Create account <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
              {loading && "Creating account"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-semibold text-foreground hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
