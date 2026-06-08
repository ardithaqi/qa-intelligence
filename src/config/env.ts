import * as dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
  BASE_URL: z.string().url(),
  HEADLESS: z
    .string()
    .transform((v) => v === "true")
    .default(true),
  PW_WORKERS: z
    .string()
    .transform((v) => Number(v))
    .pipe(z.number().int().positive())
    .default(2),
  PW_RETRIES: z
    .string()
    .transform((v) => Number(v))
    .pipe(z.number().int().nonnegative())
    .default(1),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;