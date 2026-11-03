import fs from "fs";
import { z } from "zod";
import type { GuardianConfig } from "./types";

export const DEFAULT_CONFIG_FILE = "release-guardian.config.json";

export const DEFAULT_CONFIG: GuardianConfig = {
    areas: {
        Authentication: ["auth", "login", "logout", "signin", "signup", "session", "password", "token", "oauth", "sso", "register"],
        Checkout: ["checkout", "cart", "basket", "order"],
        Payment: ["payment", "billing", "invoice", "stripe", "paypal", "subscription", "pricing"],
        Security: ["security", "permission", "role", "rbac", "admin", "csrf", "acl"],
        Profile: ["profile", "account", "settings"],
        Search: ["search", "filter"],
    },
    criticalAreas: ["Authentication", "Checkout", "Payment", "Security"],
};

const ConfigSchema = z.object({
    areas: z.record(z.string(), z.array(z.string().min(1))).optional(),
    criticalAreas: z.array(z.string()).optional(),
});

/**
 * Loads release-guardian.config.json if present. `areas` entries are merged
 * over the defaults (same name replaces); `criticalAreas` replaces the default list.
 */
export function loadGuardianConfig(configPath = DEFAULT_CONFIG_FILE): {
    config: GuardianConfig;
    warning?: string;
} {
    if (!fs.existsSync(configPath)) return { config: DEFAULT_CONFIG };

    try {
        const parsed = ConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8")));
        return {
            config: {
                areas: { ...DEFAULT_CONFIG.areas, ...(parsed.areas ?? {}) },
                criticalAreas: parsed.criticalAreas ?? DEFAULT_CONFIG.criticalAreas,
            },
        };
    } catch (error) {
        return {
            config: DEFAULT_CONFIG,
            warning: `Ignoring invalid ${configPath}: ${(error as Error).message.split("\n")[0]}`,
        };
    }
}
