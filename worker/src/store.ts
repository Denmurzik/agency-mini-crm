import postgres from "postgres";
import type { AccountInfo, AccountStatus } from "./types.js";

export type AccountRow = AccountInfo & { id: number; sessionEnc: string | null };

/** Единственная таблица, к которой обращается воркер: tg_accounts (контракт 4). */
export type AccountStore = {
  /** Последний подключённый аккаунт с сессией, либо аккаунт в ошибке, который стоит попробовать поднять снова. */
  loadActivatable(): Promise<AccountRow | null>;
  /** Последний аккаунт в любом статусе — для отображения. */
  getLatest(): Promise<AccountRow | null>;
  /** MVP: один аккаунт — прежние строки удаляются. */
  replaceAccount(a: Omit<AccountRow, "id" | "lastSeenAt" | "status">): Promise<AccountRow>;
  heartbeat(id: number): Promise<void>;
  setStatus(id: number, status: AccountStatus): Promise<void>;
  /** status='disconnected', session_enc=null */
  clearSession(id: number): Promise<void>;
  close(): Promise<void>;
};

type Raw = {
  id: number;
  phone: string;
  tg_user_id: string | number | null;
  username: string | null;
  display_name: string | null;
  session_enc: string | null;
  status: AccountStatus;
  last_seen_at: Date | null;
};

function toRow(r: Raw): AccountRow {
  return {
    id: r.id,
    phone: r.phone,
    tgUserId: r.tg_user_id === null ? 0 : Number(r.tg_user_id),
    username: r.username,
    displayName: r.display_name ?? r.username ?? r.phone,
    sessionEnc: r.session_enc,
    status: r.status,
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  };
}

const COLUMNS = "id, phone, tg_user_id, username, display_name, session_enc, status, last_seen_at";

export function createPgStore(databaseUrl: string): AccountStore {
  // prepare:false — совместимость с пулером Neon (pgbouncer).
  const sql = postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 30, connect_timeout: 15 });

  return {
    async loadActivatable() {
      const rows = await sql.unsafe<Raw[]>(
        `select ${COLUMNS} from tg_accounts
         where session_enc is not null and status in ('connected', 'error')
         order by id desc limit 1`,
      );
      return rows[0] ? toRow(rows[0]) : null;
    },
    async getLatest() {
      const rows = await sql.unsafe<Raw[]>(`select ${COLUMNS} from tg_accounts order by id desc limit 1`);
      return rows[0] ? toRow(rows[0]) : null;
    },
    async replaceAccount(a) {
      return sql.begin(async (tx) => {
        await tx`delete from tg_accounts`;
        const rows = await tx.unsafe<Raw[]>(
          `insert into tg_accounts (phone, tg_user_id, username, display_name, session_enc, status, last_seen_at)
           values ($1, $2, $3, $4, $5, 'connected', now())
           returning ${COLUMNS}`,
          [a.phone, a.tgUserId, a.username, a.displayName, a.sessionEnc],
        );
        return toRow(rows[0]!);
      });
    },
    async heartbeat(id) {
      await sql`update tg_accounts set last_seen_at = now() where id = ${id}`;
    },
    async setStatus(id, status) {
      await sql`update tg_accounts set status = ${status}::tg_account_status where id = ${id}`;
    },
    async clearSession(id) {
      await sql`update tg_accounts set status = 'disconnected', session_enc = null where id = ${id}`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
