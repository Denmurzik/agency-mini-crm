"use server";

import { redirect } from "next/navigation";
import { checkPassword, clearSessionCookie, safeNextPath, setSessionCookie } from "@/lib/auth";

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const password = String(formData.get("password") ?? "");
  if (!process.env.CRM_PASSWORD || !process.env.AUTH_SECRET) {
    return { error: "Вход не настроен: задайте CRM_PASSWORD и AUTH_SECRET" };
  }
  if (!(await checkPassword(password))) return { error: "Неверный пароль" };
  await setSessionCookie();
  redirect(safeNextPath(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
