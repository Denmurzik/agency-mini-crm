import { describe, expect, it, vi } from "vitest";
import { createSenderResolver, type ResolvableUser } from "../src/sender.js";

const user = (over: Partial<ResolvableUser> = {}): ResolvableUser => ({ id: 5, min: false, isContact: false, ...over });

describe("createSenderResolver", () => {
  it("известный контакт возвращается без запросов", async () => {
    const fetchFull = vi.fn();
    const u = user({ isContact: true });
    expect(await createSenderResolver().resolve(u, fetchFull)).toBe(u);
    expect(fetchFull).not.toHaveBeenCalled();
  });

  it("min-профиль заменяется полным, и флаг контакта берётся из него", async () => {
    const r = createSenderResolver();
    const full = user({ isContact: true });
    expect(await r.resolve(user({ min: true }), async () => full)).toBe(full);
  });

  it("результат кэшируется по id", async () => {
    const r = createSenderResolver();
    const fetchFull = vi.fn().mockResolvedValue(user({ isContact: true }));
    await r.resolve(user(), fetchFull);
    await r.resolve(user(), fetchFull);
    expect(fetchFull).toHaveBeenCalledTimes(1);
  });

  it("кэш истекает по ttl", async () => {
    let t = 0;
    const r = createSenderResolver({ ttlMs: 1000, now: () => t });
    const fetchFull = vi.fn().mockResolvedValue(user());
    await r.resolve(user(), fetchFull);
    t = 1001;
    await r.resolve(user(), fetchFull);
    expect(fetchFull).toHaveBeenCalledTimes(2);
  });

  it("min-профиль, который не удалось дозапросить, даёт null (сообщение пропускается)", async () => {
    const r = createSenderResolver();
    expect(await r.resolve(user({ min: true }), async () => null)).toBeNull();
    expect(await r.resolve(user({ min: true }), async () => Promise.reject(new Error("x")))).toBeNull();
    expect(await r.resolve(user({ min: true }), async () => user({ min: true }))).toBeNull();
  });

  it("полному пользователю без флага контакта верим, если дозапрос упал", async () => {
    const u = user();
    expect(await createSenderResolver().resolve(u, async () => Promise.reject(new Error("x")))).toBe(u);
  });
});
