"use client";

import { useRouter } from "next/navigation";
import { useSidebar } from "@/components/sidebar-state";
import { UpcomingSidebar } from "./upcoming-sidebar";

// Phone menu for the calendar section: the upcoming events list, as the desktop left column shows.
// Stays mounted while the menu is closed so the loaded list is still there next time it opens;
// opening refreshes it in the background.
export function CalendarMobileUpcoming() {
	const { mobile, mobileOpen, toggle } = useSidebar();
	const router = useRouter();
	if (!mobile) return null;
	return (
		<UpcomingSidebar drawer refreshKey={mobileOpen} onSelect={(event) => {
			toggle();
			router.push(`/calendar?event=${encodeURIComponent(event.id)}`);
		}} />
	);
}
