// Which Convex deployment this client talks to.
//
// The app has two independent backends — 开发测试环境 and 生产环境 — each with
// its own database *and its own sessions table*. A token minted by one is
// meaningless to the other, so switching environments always means signing in
// again. 生产环境 is the default.
//
// The URLs below are public identifiers (they are inlined into the bundle
// either way); the VITE_ overrides exist so a build can be pointed elsewhere
// without editing this file.

import { ConvexReactClient } from "convex/react";

export type EnvKey = "prod" | "dev";

export type Backend = {
  /** Shown in the switcher. */
  label: string;
  /** Deployment slug, surfaced so it is obvious which database you are on. */
  host: string;
  url: string;
};

export const BACKENDS: Record<EnvKey, Backend> = {
  prod: {
    label: "生产环境",
    host: "coordinated-camel-303",
    url:
      (import.meta.env.VITE_CONVEX_URL_PROD as string | undefined) ??
      "https://coordinated-camel-303.convex.cloud",
  },
  dev: {
    label: "开发测试环境",
    host: "fine-ibis-920",
    url:
      (import.meta.env.VITE_CONVEX_URL_DEV as string | undefined) ??
      "https://fine-ibis-920.convex.cloud",
  },
};

/** 生产环境 — the app defaults to the production backend. */
export const DEFAULT_ENV: EnvKey = "prod";

/** Order shown in the switcher; the default comes first. */
export const ENV_KEYS: EnvKey[] = ["prod", "dev"];

const ENV_KEY = "flowboard.env";

function isEnvKey(value: unknown): value is EnvKey {
  return value === "prod" || value === "dev";
}

/** The remembered choice, falling back to 生产环境. */
export function readEnv(): EnvKey {
  try {
    const raw = localStorage.getItem(ENV_KEY);
    return isEnvKey(raw) ? raw : DEFAULT_ENV;
  } catch {
    return DEFAULT_ENV;
  }
}

export function writeEnv(env: EnvKey): void {
  try {
    localStorage.setItem(ENV_KEY, env);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

/**
 * One client per environment, cached for the life of the tab.
 *
 * Switching back and forth must not accumulate Convex clients (each holds a
 * websocket), and React's StrictMode double-mounts effects in development, so
 * clients are owned here rather than created inside a component effect.
 */
const clients = new Map<EnvKey, ConvexReactClient>();

export function clientFor(env: EnvKey): ConvexReactClient {
  let client = clients.get(env);
  if (!client) {
    client = new ConvexReactClient(BACKENDS[env].url);
    clients.set(env, client);
  }
  return client;
}
