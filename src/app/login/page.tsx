import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isAuthenticated, safeNextPath } from "@/lib/auth";

export const metadata: Metadata = { title: "Вход · Mini CRM" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next } = await searchParams;
  const target = safeNextPath(Array.isArray(next) ? next[0] : next);
  if (await isAuthenticated()) redirect(target);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4">
      <LoginForm next={target} />
    </main>
  );
}
