import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_SERVER = "https://bombe.malwarevillage.org";
export const CLIENT_CONFIG_PATH = "/.well-known/bombe-client.json";

export interface ClientConfig {
  version: number;
  auth: {
    region: string;
    userPoolId: string;
    userPoolClientId: string;
  };
  data: {
    region: string;
    url: string;
  };
  uploadApiUrl: string;
}

interface RawConfig {
  version?: number;
  auth?: {
    aws_region?: string;
    user_pool_id?: string;
    user_pool_client_id?: string;
  };
  data?: {
    aws_region?: string;
    url?: string;
  };
  upload_api?: {
    endpoint?: string;
  };
  custom?: {
    API?: Record<string, { endpoint?: string }>;
  };
}

export interface ConfigOptions {
  config?: string;
  server?: string;
}

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new CliError(`Client configuration is missing ${name}.`);
  return value;
};

export const normalizeClientConfig = (raw: RawConfig): ClientConfig => {
  const legacyApi = Object.values(raw.custom?.API ?? {})[0]?.endpoint;
  return {
    version: raw.version ?? 1,
    auth: {
      region: required(raw.auth?.aws_region, "auth.aws_region"),
      userPoolId: required(raw.auth?.user_pool_id, "auth.user_pool_id"),
      userPoolClientId: required(
        raw.auth?.user_pool_client_id,
        "auth.user_pool_client_id",
      ),
    },
    data: {
      region: required(raw.data?.aws_region, "data.aws_region"),
      url: required(raw.data?.url, "data.url"),
    },
    uploadApiUrl: required(
      raw.upload_api?.endpoint ?? legacyApi,
      "upload_api.endpoint",
    ).replace(/\/+$/, ""),
  };
};

const readConfigSource = async (source: string): Promise<RawConfig> => {
  let text: string;
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new CliError(
        `Unable to load BOMBE client configuration (${response.status}). ` +
          "Use --config /path/to/amplify_outputs.json for local development.",
      );
    }
    text = await response.text();
  } else {
    text = await readFile(resolve(source), "utf8");
  }

  try {
    return JSON.parse(text) as RawConfig;
  } catch {
    throw new CliError(`Invalid JSON in client configuration: ${source}`);
  }
};

export const loadClientConfig = async (
  options: ConfigOptions,
): Promise<ClientConfig> => {
  const source =
    options.config ??
    process.env.BOMBE_CONFIG ??
    `${(options.server ?? process.env.BOMBE_SERVER ?? DEFAULT_SERVER).replace(/\/+$/, "")}${CLIENT_CONFIG_PATH}`;
  return normalizeClientConfig(await readConfigSource(source));
};
