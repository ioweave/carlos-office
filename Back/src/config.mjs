import { loadEnvFile } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

try {
  loadEnvFile(resolve(here, "../.env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.LOCAL_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid LOCAL_PORT: ${process.env.LOCAL_PORT}`);
}

const host = process.env.LOCAL_HOST?.trim();
if (!host) throw new Error("LOCAL_HOST must be configured");

const frontendOriginValue = process.env.FRONTEND_ORIGIN?.trim() || "http://127.0.0.1:3003";
let frontendOrigin;

try {
  frontendOrigin = new URL(frontendOriginValue).origin;
} catch {
  throw new Error(`Invalid FRONTEND_ORIGIN: ${frontendOriginValue}`);
}

const config = {
  host,
  port,
  frontendOrigin,
};

export default config;
