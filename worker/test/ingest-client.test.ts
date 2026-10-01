import { describe, expect, it, vi } from "vitest";
import { sendIngest } from "../src/ingest-client.js";
import { silentLogger } from "../src/log.js";
import type { IngestPayload } from "../src/filter.js";

const payload: IngestPayload = {
  source: "telegram",
  name: "Иван",
  contact: "@ivan",
  request: "привет",
  tgUserId: 1,
  tgUsername: "ivan",
  message: { text: "привет", externalId: "9:1:1" },
};

const base = { url: "https://crm/api/ingest", secret: "sec", logger: silentLogger, sleep: async () => {} };
const res = (status: number) => new Response("{}", { status });

describe("sendIngest", () => {
  it("шлёт POST с Bearer и JSON-телом", async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    expect(await sendIngest(payload, { ...base, fetch: f })).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://crm/api/ingest");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer sec");
    expect(JSON.parse(init.body)).toEqual(payload);
  });

  it("повторяет при 5xx и сетевой ошибке, затем успех", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(502))
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue(res(200));
    expect(await sendIngest(payload, { ...base, fetch: f })).toBe(true);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("сдаётся после 3 попыток и не бросает", async () => {
    const f = vi.fn().mockResolvedValue(res(500));
    expect(await sendIngest(payload, { ...base, fetch: f })).toBe(false);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("не повторяет при 4xx", async () => {
    const f = vi.fn().mockResolvedValue(res(401));
    expect(await sendIngest(payload, { ...base, fetch: f })).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
