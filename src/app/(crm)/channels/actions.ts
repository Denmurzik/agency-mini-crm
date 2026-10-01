"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { CHANNELS_LOCKED_MESSAGE } from "@/components/channels/locked";
import type { ActionResult } from "@/lib/leads/actions";
import { WorkerClientError, workerClient } from "@/lib/worker-client";

async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    await requireSession();
    if (process.env.CHANNELS_LOCKED === "1") return { ok: false, error: CHANNELS_LOCKED_MESSAGE };
    return await fn();
  } catch (err) {
    if (err instanceof WorkerClientError) return { ok: false, error: err.message };
    if (err instanceof Error && err.message === "Требуется вход") return { ok: false, error: err.message };
    console.error("worker action failed", err);
    return { ok: false, error: "Не удалось выполнить действие, попробуйте ещё раз" };
  }
}

const phoneSchema = z
  .string()
  .transform((v) => v.replace(/[^\d+]/g, ""))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, "Введите номер в международном формате, например +79991234567"));
const codeSchema = z.string().trim().min(1, "Введите код из Telegram").max(16);
const passwordSchema = z.string().min(1, "Введите пароль").max(256);

export async function sendCodeAction(phone: string): Promise<ActionResult> {
  return guard(async () => {
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await workerClient.sendCode(parsed.data.startsWith("+") ? parsed.data : `+${parsed.data}`);
    return { ok: true, data: null };
  });
}

/** `needPassword: true` — на аккаунте включена двухфакторная защита, нужен пароль. */
export async function signInAction(code: string): Promise<ActionResult<{ needPassword: boolean }>> {
  return guard<{ needPassword: boolean }>(async () => {
    const parsed = codeSchema.safeParse(code);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const res = await workerClient.signIn(parsed.data);
    if ("needPassword" in res) return { ok: true, data: { needPassword: true } };
    revalidatePath("/channels");
    return { ok: true, data: { needPassword: false } };
  });
}

export async function passwordAction(password: string): Promise<ActionResult> {
  return guard(async () => {
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    await workerClient.password(parsed.data);
    revalidatePath("/channels");
    return { ok: true, data: null };
  });
}

export async function disconnectTelegramAction(): Promise<ActionResult> {
  return guard(async () => {
    await workerClient.logout();
    revalidatePath("/channels");
    return { ok: true, data: null };
  });
}
