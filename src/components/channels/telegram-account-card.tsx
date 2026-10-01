"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Send, Unplug } from "lucide-react";
import { toast } from "sonner";
import { disconnectTelegramAction, passwordAction, sendCodeAction, signInAction } from "@/app/(crm)/channels/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CHANNELS_LOCKED_MESSAGE } from "./locked";
import { StatusPill } from "./status-pill";

export type AccountView = {
  status: "connected" | "disconnected" | "error";
  online: boolean;
  /** Телефон уже замаскирован на сервере. */
  phone: string;
  username: string | null;
  displayName: string | null;
  lastSeen: string | null;
};

type Step = "phone" | "code" | "password";

export function TelegramAccountCard({
  account,
  loadFailed,
  locked,
  business,
}: {
  account: AccountView | null;
  loadFailed: boolean;
  locked: boolean;
  /** Серверный блок «Telegram Business» — основной способ подключения, показываем над userbot. */
  business: React.ReactNode;
}) {
  const connected = account?.status === "connected";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4" />
          Личный Telegram
        </CardTitle>
        <CardDescription>
          В CRM попадают входящие личные сообщения от людей, которых нет в контактах. Группы, боты и контакты игнорируются.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        {business}
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <h3 className="text-sm font-medium">Userbot</h3>
            <p className="text-xs text-muted-foreground">Для аккаунтов без Premium. Требуются api_id и api_hash с my.telegram.org; неофициальный клиент, лучше подключать рабочий или второй аккаунт.</p>
          </div>
          {loadFailed ? (
            <StatusPill tone="error">Не удалось прочитать состояние аккаунта</StatusPill>
          ) : (
            <AccountStatus account={account} />
          )}
          {connected ? <Disconnect locked={locked} /> : <ConnectFlow reconnect={!!account} locked={locked} />}
          {locked && <p className="text-xs text-muted-foreground">{CHANNELS_LOCKED_MESSAGE}.</p>}
        </section>
      </CardContent>
    </Card>
  );
}

function AccountStatus({ account }: { account: AccountView | null }) {
  if (!account) return <StatusPill tone="idle">Не подключён</StatusPill>;
  const name = account.displayName || account.phone;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {account.status === "error" ? (
        <StatusPill tone="error">Ошибка</StatusPill>
      ) : account.status === "disconnected" ? (
        <StatusPill tone="idle">Отключён</StatusPill>
      ) : account.online ? (
        <StatusPill tone="ok">Онлайн</StatusPill>
      ) : (
        <StatusPill tone="warn">Офлайн (воркер не отвечает)</StatusPill>
      )}
      <span className="text-sm font-medium">{name}</span>
      {account.username && <span className="text-sm text-muted-foreground">@{account.username}</span>}
      <span className="text-sm text-muted-foreground">{account.phone}</span>
      {account.lastSeen && account.status === "connected" && <span className="text-xs text-muted-foreground">Heartbeat: {account.lastSeen}</span>}
    </div>
  );
}

function ConnectFlow({ reconnect, locked }: { reconnect: boolean; locked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("phone");
    setValue("");
    setError(null);
    setPending(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (step === "phone") {
        const res = await sendCodeAction(value);
        if (!res.ok) return setError(res.error);
        setStep("code");
        setValue("");
      } else if (step === "code") {
        const res = await signInAction(value);
        if (!res.ok) return setError(res.error);
        if (res.data.needPassword) {
          setStep("password");
          setValue("");
        } else {
          done();
        }
      } else {
        const res = await passwordAction(value);
        if (!res.ok) return setError(res.error);
        done();
      }
    } catch {
      setError("Не удалось выполнить запрос, проверьте соединение");
    } finally {
      setPending(false);
    }
  }

  function done() {
    toast.success("Telegram-аккаунт подключён");
    setOpen(false);
    reset();
    router.refresh();
  }

  const copy = {
    phone: { label: "Номер телефона", placeholder: "+79991234567", hint: "Telegram пришлёт код входа в приложение на этом аккаунте.", action: "Получить код", type: "tel" },
    code: { label: "Код из Telegram", placeholder: "12345", hint: "Код придёт в Telegram. Не пересылайте его никому, даже себе: Telegram аннулирует пересланный код.", action: "Войти", type: "text" },
    password: { label: "Пароль двухфакторной защиты", placeholder: "", hint: "На аккаунте включён облачный пароль.", action: "Подтвердить", type: "password" },
  }[step];

  return (
    <>
      <div>
        <Button onClick={() => setOpen(true)} disabled={locked}>
          <Send />
          {reconnect ? "Подключить" : "Подключить аккаунт"}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Подключение Telegram</DialogTitle>
            <DialogDescription>
              Шаг {step === "phone" ? 1 : step === "code" ? 2 : 3}: {copy.hint}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tg-step">{copy.label}</Label>
              <Input
                key={step}
                id="tg-step"
                type={copy.type}
                inputMode={step === "password" ? undefined : step === "phone" ? "tel" : "numeric"}
                autoComplete={step === "code" ? "one-time-code" : step === "password" ? "current-password" : "tel"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={copy.placeholder}
                autoFocus
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              {step !== "phone" && (
                <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                  Начать заново
                </Button>
              )}
              <Button type="submit" disabled={pending || !value.trim()}>
                {pending && <LoaderCircle className="animate-spin" />}
                {copy.action}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Disconnect({ locked }: { locked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function disconnect() {
    setPending(true);
    try {
      const res = await disconnectTelegramAction();
      if (!res.ok) return void toast.error(res.error);
      toast.success("Аккаунт отключён");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Не удалось отключить аккаунт, проверьте соединение");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div>
        <Button variant="outline" onClick={() => setOpen(true)} disabled={locked}>
          <Unplug />
          Отключить
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отключить аккаунт?</DialogTitle>
            <DialogDescription>Сессия будет удалена, новые личные сообщения перестанут попадать в CRM. Уже созданные лиды останутся.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={disconnect} disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              Отключить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
