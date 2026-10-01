export type AccountStatus = "connected" | "disconnected" | "error";

/** Контракт 3: AccountInfo. */
export type AccountInfo = {
  phone: string;
  tgUserId: number;
  username: string | null;
  displayName: string;
  status: AccountStatus;
  lastSeenAt: string | null;
};

export type PendingStage = "code" | "password" | null;

export type StatusResponse = { account: AccountInfo | null; pending: PendingStage };

export type SignInResponse = { ok: true; account: AccountInfo } | { needPassword: true };

/** Что менеджер аккаунта предоставляет HTTP-слою. */
export type WorkerService = {
  status(): Promise<StatusResponse>;
  sendCode(phone: string): Promise<void>;
  signIn(code: string): Promise<SignInResponse>;
  password(password: string): Promise<{ ok: true; account: AccountInfo }>;
  logout(): Promise<void>;
};
