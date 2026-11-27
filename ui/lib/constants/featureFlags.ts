/**
 * Feature flag ids the dashboard gates on. Each must match an id registered in
 * Go (transports/bifrost-http/lib/config.go, registerFeatureFlags).
 */
export const FEATURE_FLAGS = {
	/** The phrase suggestions dashboard on semantic model routers. Off by default everywhere; the APIs work either way. */
	phraseSuggestions: "phrase-suggestions",
} as const;