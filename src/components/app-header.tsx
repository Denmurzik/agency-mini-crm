import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { NavLinks } from "./nav-links";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold tracking-tight">Mini CRM</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">заявки агентства</span>
        </div>
        <NavLinks />
        <form action={logoutAction} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm">
            <LogOut />
            <span className="hidden sm:inline">Выйти</span>
            <span className="sr-only sm:hidden">Выйти</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
