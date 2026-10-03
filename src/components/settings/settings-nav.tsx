"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SectionNavSheet } from "../section-nav-sheet";
import { isActiveSettingsPath, settingsNavSections } from "./settings-nav-utils";

export function SettingsNav() {
	const pathname = usePathname();
	const currentLabel = settingsNavSections.flatMap((section) => section.items).find((item) => isActiveSettingsPath(pathname, item.href))?.label ?? "Settings";

	return (
		<SectionNavSheet title="Settings menu" label={currentLabel} className="w-full px-4 py-4 md:min-h-full md:w-64 md:border-r md:border-blue-100/70 md:py-10">
			<div className="sticky top-6 space-y-7">
				{settingsNavSections.map((section) => (
					<div key={section.label} className="space-y-3">
						<h2 className="px-4 text-xs font-semibold uppercase tracking-wide text-neutral-500">
							{section.label}
						</h2>
						<nav className="space-y-px">
							{section.items.map((item) => {
								const active = isActiveSettingsPath(pathname, item.href);
								return (
									<Link
										key={item.href}
										href={item.href}
										className={cn(
											"block rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
											active
												? "bg-blue-100 text-blue-900"
												: "text-neutral-600 hover:bg-white/70 hover:text-neutral-900",
										)}
									>
										{item.label}
									</Link>
								);
							})}
						</nav>
					</div>
				))}
			</div>
		</SectionNavSheet>
	);
}
