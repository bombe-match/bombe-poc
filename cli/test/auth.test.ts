import assert from "node:assert/strict";
import test from "node:test";
import { jwtPayload } from "../src/auth.js";

test("decodes Cognito JWT payloads", () => {
  const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
  assert.deepEqual(jwtPayload(`header.${payload}.signature`), { sub: "user-1" });
});
