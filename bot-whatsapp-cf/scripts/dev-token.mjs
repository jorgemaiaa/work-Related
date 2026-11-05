// DEV_TOKEN para as rotas /dev/*: do ambiente ou, em local, do .dev.vars.
import { existsSync, readFileSync } from "node:fs";

export function devToken() {
  if (process.env.DEV_TOKEN) return process.env.DEV_TOKEN;
  if (!existsSync(".dev.vars")) return "";
  const linha = readFileSync(".dev.vars", "utf8").split("\n").find((l) => l.startsWith("DEV_TOKEN="));
  return linha ? linha.slice("DEV_TOKEN=".length).trim() : "";
}
