import type { AuthContext } from "./auth.js";
import type { ClientConfig } from "./config.js";
import { CliError } from "./errors.js";

interface GraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

export const graphql = async <T>(
  config: ClientConfig,
  auth: AuthContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(config.data.url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: auth.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new CliError(`BOMBE data API returned HTTP ${response.status}.`);
  }
  const body = (await response.json()) as GraphQlResponse<T>;
  if (body.errors?.length) {
    throw new CliError(body.errors.map((error) => error.message).join("; "));
  }
  if (!body.data) throw new CliError("BOMBE data API returned no data.");
  return body.data;
};

export const parseAwsJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};
