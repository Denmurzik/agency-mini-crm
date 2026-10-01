/** Что нужно знать об отправителе, чтобы решить, контакт он или нет. */
export type ResolvableUser = { id: number; min: boolean; isContact: boolean };

type CacheEntry<T> = { at: number; user: T };

/**
 * Флаг `contact` достоверен только у полного пользователя: у «min»-профиля его нет, и друг
 * мог бы попасть в лиды. Поэтому для всех, кто не помечен контактом, один раз запрашиваем
 * полный профиль и кэшируем результат по id.
 */
export function createSenderResolver<T extends ResolvableUser>(opts: { ttlMs?: number; maxSize?: number; now?: () => number } = {}) {
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const maxSize = opts.maxSize ?? 500;
  const now = opts.now ?? Date.now;
  const cache = new Map<number, CacheEntry<T>>();

  return {
    /** null: надёжно определить отправителя не удалось (min-профиль без полного), сообщение пропускаем. */
    async resolve(user: T, fetchFull: () => Promise<T | null>): Promise<T | null> {
      if (!user.min && user.isContact) return user;
      const hit = cache.get(user.id);
      if (hit && now() - hit.at < ttl) return hit.user;

      let full: T | null = null;
      try {
        full = await fetchFull();
      } catch {
        full = null;
      }
      if (full && !full.min) {
        if (cache.size >= maxSize) cache.clear();
        cache.set(user.id, { at: now(), user: full });
        return full;
      }
      // Полный профиль недоступен: полному пользователю без флага контакта верим, min-профилю нет.
      return user.min ? null : user;
    },
  };
}
