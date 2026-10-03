"use client";

import {
  DatabaseBackup,
  Globe2,
  Activity,
  Mail,
  Settings,
  Palette,
  BadgeDollarSign,
  Users,
  Route,
  Webhook,
  KeyRound,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/use-current-user";
import { NavItem } from "./components-nav";
import { NavSectionHeader, useSectionOpen } from "./nav-section-header";
import { SidebarFooter } from "./sidebar-footer";
import { SidebarHeader } from "./sidebar-header";
import { SidebarScaffold } from "./sidebar-scaffold";
import { useSidebar } from "./sidebar-state";

type AdminLinkPermission = "primary" | "domains" | "users";

type AdminNavLink = {
  href: string;
  label: string;
  icon: typeof Settings;
  permission?: AdminLinkPermission;
};

const sections: { label?: string; links: AdminNavLink[] }[] = [
  {
    // label: "Overview",
    links: [{ href: "/admin", label: "Overview", icon: Settings }],
  },
  {
    label: "Email",
    links: [
      { href: "/mailboxes", label: "Mailboxes", icon: Mail },
      { href: "/domains", label: "Domains", icon: Globe2, permission: "domains" },
      { href: "/routing", label: "Routing", icon: Route },
      { href: "/webhooks", label: "Webhooks", icon: Webhook, permission: "primary" },
    ],
  },
  {
    label: "Administration",
    links: [
      { href: "/api-keys", label: "API keys", icon: KeyRound, permission: "primary" },
      { href: "/general", label: "General", icon: Settings, permission: "primary" },
      { href: "/agent", label: "Agent", icon: Bot, permission: "primary" },
      { href: "/accounts", label: "Accounts", icon: Users },
      { href: "/activity", label: "Activity", icon: Activity, permission: "primary" },
      { href: "/backups", label: "Backups", icon: DatabaseBackup, permission: "primary" },
    ],
  },
  {
    label: "Product",
    links: [
      { href: "/branding", label: "Branding", icon: Palette, permission: "primary" },
      { href: "/licenses", label: "Licenses", icon: BadgeDollarSign, permission: "primary" },
    ],
  },
];

function AdminSection({ label, links, showDivider, minimal }: { label?: string; links: AdminNavLink[]; showDivider: boolean; minimal: boolean }) {
  const [open, toggle] = useSectionOpen(`mailflare:nav:admin-section-open:${label ?? ""}`);
  // Unlabelled sections have nothing to toggle; the icon rail always shows everything.
  const expanded = minimal || !label || open;
  return (
    <section>
      {showDivider && <hr className="mx-6 mb-3 border-neutral-200/70" />}
      {!minimal && label && <NavSectionHeader label={label} open={open} onToggle={toggle} />}
      {expanded && (
        <div className="space-y-px">
          {links.map((link) => (
            <NavItem link={link} key={link.href} />
          ))}
        </div>
      )}
    </section>
  );
}

export function AdminNav({ className }: { className?: string }) {
  const { minimal } = useSidebar();
  const user = useCurrentUser();

  function canSee(link: AdminNavLink): boolean {
    if (!link.permission) return true;
    if (!user) return false;
    if (link.permission === "primary") return user.isPrimaryAdmin;
    if (link.permission === "domains") return user.isPrimaryAdmin || user.canManageDomains;
    return user.isPrimaryAdmin || user.canManageUsers;
  }

  return (
    <SidebarScaffold className={className} header={<SidebarHeader href="/inbox" label="Admin" />} footer={<SidebarFooter />}>
      <div className={cn("space-y-4", minimal && "space-y-2 pl-1")}>
        {sections.map((section, sectionIndex) => {
          const links = section.links.filter(canSee);
          if (links.length === 0) return null;

          return (
            // The first section has no label, so fall back to its first href for a stable key.
            <AdminSection key={section.label ?? links[0].href} label={section.label} links={links} showDivider={minimal && sectionIndex > 0} minimal={minimal} />
          );
        })}
      </div>
    </SidebarScaffold>
  );
}
