import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  DEFAULT_BASE_NAME,
  DEFAULT_TABLE_NAME,
  DEFAULT_UNMATCHED_REMINDER_MINUTES
} from "./constants.js";

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_VLM_MODEL: z.string().optional(),
  LARK_APP_ID: z.string().min(1),
  LARK_APP_SECRET: z.string().min(1),
  LARK_BASE_NAME: z.string().default(DEFAULT_BASE_NAME),
  LARK_TABLE_NAME: z.string().default(DEFAULT_TABLE_NAME),
  LARK_BASE_TOKEN: z.string().optional(),
  LARK_TABLE_ID: z.string().optional(),
  UNMATCHED_REMINDER_MINUTES: z.coerce.number().int().positive().default(DEFAULT_UNMATCHED_REMINDER_MINUTES)
});

export type AppEnv = z.infer<typeof envSchema>;

export function getEnvFilePath(cwd: string = process.cwd()): string {
  return path.join(cwd, ".env");
}

export function envFileExists(cwd: string = process.cwd()): boolean {
  return existsSync(getEnvFilePath(cwd));
}

export function loadEnv(cwd: string = process.cwd()): AppEnv {
  const envPath = getEnvFilePath(cwd);
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, "utf8");
    const parsed = dotenv.parse(raw);
    Object.assign(process.env, parsed);
  }
  return envSchema.parse(process.env);
}
