import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { WorkerError } from "./errors.js";
import { errText, type Logger } from "./log.js";
import type { WorkerService } from "./types.js";

export type HttpDeps = {
  service: WorkerService;
  secret: string;
  logger: Logger;
};

const MAX_BODY_BYTES = 16 * 1024;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

/** Сравнение через хеши: одинаковая длина и постоянное время независимо от входа. */
export function isAuthorized(header: string | undefined, secret: string): boolean {
  const match = header?.match(/^Bearer (.+)$/);
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]!), sha256(secret));
}

const phoneBody = z.object({ phone: z.string({ error: "Укажите номер телефона" }).min(1, "Укажите номер телефона") });
const codeBody = z.object({
  code: z
    .string({ error: "Введите код" })
    .transform((c) => c.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{4,8}$/, "Код состоит из 4-8 цифр")),
});
const passwordBody = z.object({ password: z.string({ error: "Введите пароль" }).min(1, "Введите пароль") });

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(json) });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new WorkerError("Слишком большое тело запроса", 413);
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkerError("Тело запроса должно быть JSON", 400);
  }
}

async function body<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) throw new WorkerError(parsed.error.issues[0]?.message ?? "Неверное тело запроса", 400);
  return parsed.data;
}

type Route = (req: IncomingMessage, service: WorkerService) => Promise<unknown>;

const ROUTES: Record<string, { method: "GET" | "POST"; handler: Route }> = {
  "/status": { method: "GET", handler: (_req, s) => s.status() },
  "/auth/send-code": {
    method: "POST",
    handler: async (req, s) => {
      await s.sendCode((await body(req, phoneBody)).phone);
      return { ok: true };
    },
  },
  "/auth/sign-in": { method: "POST", handler: async (req, s) => s.signIn((await body(req, codeBody)).code) },
  "/auth/password": { method: "POST", handler: async (req, s) => s.password((await body(req, passwordBody)).password) },
  "/auth/logout": {
    method: "POST",
    handler: async (_req, s) => {
      await s.logout();
      return { ok: true };
    },
  },
};

export function createHttpServer({ service, secret, logger }: HttpDeps): Server {
  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://worker").pathname;

      // Без авторизации: проверка живости для Railway.
      if (path === "/health" && req.method === "GET") return send(res, 200, { ok: true });

      if (!isAuthorized(req.headers.authorization, secret)) return send(res, 401, { error: "Не авторизован" });

      const route = ROUTES[path];
      if (!route) return send(res, 404, { error: "Не найдено" });
      if (req.method !== route.method) return send(res, 405, { error: "Метод не поддерживается" });

      send(res, 200, await route.handler(req, service));
    } catch (err) {
      if (err instanceof WorkerError) return send(res, err.status, { error: err.message });
      logger.error("Необработанная ошибка HTTP", { reason: errText(err) });
      send(res, 500, { error: "Внутренняя ошибка воркера" });
    }
  });
}
