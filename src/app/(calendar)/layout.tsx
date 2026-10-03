"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Sparkles } from "lucide-react";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AssistantOpenContext } from "@/components/agent/assistant-open-state";
import { AuthGuard } from "@/components/auth/auth-guard";
import { ComposeProvider } from "@/components/compose/compose-context";
import { FloatingComposer } from "@/components/compose/floating-composer";
import { LicenseIndicator } from "@/components/license-indicator";
import { MailSearchProvider } from "@/components/mail-search/mail-search-context";
import { MailboxProvider } from "@/components/mailbox-provider";
import { MailboxSelector } from "@/components/mailbox-selector";
import { SidebarAside, MobileMenuButton, MobileBrandIcon } from "@/components/sidebar-aside";
import { SidebarHeader } from "@/components/sidebar-header";
import { SidebarProvider } from "@/components/sidebar-state";
import { ShortcutsProvider } from "@/components/shortcuts";
import { Button } from "@/components/ui/button";
import clsx from "clsx";
import { CalendarMobileUpcoming } from "./calendar-mobile-upcoming";
import { useDashboardState } from "../(dashboard)/dashboard-state";
import { useAssistantAvailability } from "../(dashboard)/use-assistant-availability";

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { assistantOpen, setAssistantOpen, assistantFullSize, setAssistantFullSize } = useDashboardState();
  const assistantEnabled = useAssistantAvailability();
  const assistantVisible = assistantEnabled === true && assistantOpen;

  useEffect(() => {
    if (assistantEnabled === false && (assistantOpen || assistantFullSize)) {
      setAssistantOpen(false);
      setAssistantFullSize(false);
    }
  }, [assistantEnabled, assistantOpen, assistantFullSize, setAssistantOpen, setAssistantFullSize]);

  return (
    <AuthGuard>
      <SidebarProvider mobileOverlay>
        <MailboxProvider>
          <ComposeProvider>
            <MailSearchProvider>
              <ShortcutsProvider>
              <div className="grid h-dvh grid-cols-[minmax(0,1fr)] overflow-hidden bg-[#f6f8fc]">
                <SidebarAside className="md:hidden"><CalendarMobileUpcoming /></SidebarAside>
                <div className="flex min-h-0 min-w-0 flex-col">
                  <header className="flex h-16 w-full shrink-0 items-center gap-3 pr-4 text-sm max-md:h-auto max-md:flex-wrap max-md:gap-y-2 max-md:pb-2">
                    <MobileMenuButton className="ml-2" />
                  <MobileBrandIcon />
                    <div className="hidden shrink-0 px-3 md:block [&>div]:mb-0" style={{ width: "calc(var(--sidebar-width) + 1.5rem)" }}><SidebarHeader href="/inbox" /></div>
                    <div className="relative shrink-0 md:hidden"><select aria-label="Calendar section" value={pathname === "/booking" ? "/booking" : "/calendar"} onChange={(event) => router.push(event.target.value)} className="h-10 appearance-none rounded-full border-0 bg-white pl-4 pr-10 text-sm font-medium text-neutral-700"><option value="/booking">Bookings</option><option value="/calendar">Calendar</option></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-600" /></div>
                    <span className="flex-1 md:hidden" />
                    <div className="flex min-w-0 flex-1 items-center gap-3 md:overflow-x-auto max-md:contents">
                      <nav aria-label="Calendar sections" className="flex shrink-0 max-md:hidden items-center rounded-full bg-white p-1">
                        <Link href="/booking" aria-current={pathname === "/booking" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/booking" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>Bookings</Link>
                        <Link href="/calendar" aria-current={pathname === "/calendar" ? "page" : undefined} className={clsx("rounded-full px-4 py-2 text-sm font-medium transition-colors", pathname === "/calendar" ? "bg-blue-600 text-white" : "text-neutral-600 hover:bg-neutral-100")}>Calendar</Link>
                      </nav>
                      <div id="calendar-header-slot" className="flex min-w-0 flex-1 items-center md:min-w-max max-md:order-last max-md:basis-full max-md:pl-3 max-md:empty:hidden" />
                    </div>
                    <LicenseIndicator />
                    {assistantEnabled && <Button type="button" variant="ghost" size="sm" className={assistantOpen ? "bg-blue-50 text-blue-700" : "text-neutral-600"} onClick={() => { setAssistantOpen((current) => !current); setAssistantFullSize(false); }} aria-label={assistantOpen ? "Close email assistant" : "Open email assistant"} aria-expanded={assistantOpen} aria-controls="email-assistant-panel"><Sparkles className="h-5 w-5" /></Button>}
                    <MailboxSelector />
                  </header>
                  <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
                    <AssistantOpenContext.Provider value={assistantVisible}>
                      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-[#f6f8fc] overscroll-contain scrollbar-gutter-stable" aria-hidden={assistantVisible && assistantFullSize} inert={assistantVisible && assistantFullSize}>
                        <div key={pathname} className="page-transition-enter h-full min-h-0">{children}</div>
                      </main>
                    </AssistantOpenContext.Provider>
                    <aside className={clsx(assistantFullSize ? "pl-0" : "pl-4", "min-h-0 min-w-0 shrink-0 overflow-hidden pb-2 pr-2 max-md:p-0 transition-[width] duration-300 ease-in-out motion-reduce:transition-none", assistantVisible ? "" : "opacity-0")} style={{ width: assistantVisible ? assistantFullSize ? "100%" : "min(390px, 100%)" : "0px" }} aria-hidden={!assistantVisible} inert={!assistantVisible}>
                      {assistantEnabled && <AgentPanel open={assistantVisible} fullSize={assistantFullSize} onToggleFullSize={() => setAssistantFullSize((current) => !current)} onClose={() => { setAssistantOpen(false); setAssistantFullSize(false); }} />}
                    </aside>
                  </div>
                </div>
                <FloatingComposer />
              </div>
              </ShortcutsProvider>
            </MailSearchProvider>
          </ComposeProvider>
        </MailboxProvider>
      </SidebarProvider>
    </AuthGuard>
  );
}
