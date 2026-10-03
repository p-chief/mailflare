// Titles shown in the phone top bar, keyed by exact path. Detail pages are absent on purpose:
// they keep their own in-page heading.
export const adminPageTitles: Record<string, string> = {
	"/admin": "Admin settings",
	"/mailboxes": "Mailboxes",
	"/domains": "Domains",
	"/routing": "Routing",
	"/webhooks": "Webhooks",
	"/api-keys": "Admin API keys",
	"/general": "General",
	"/agent": "Agent",
	"/accounts": "Accounts",
	"/activity": "Activity",
	"/backups": "Backups",
	"/branding": "Branding",
	"/licenses": "Licenses",
	"/ai-usage": "AI usage",
};
