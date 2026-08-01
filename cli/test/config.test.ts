import assert from "node:assert/strict";
import test from "node:test";
import { normalizeClientConfig } from "../src/config.js";

test("normalizes the public client configuration", () => {
  assert.deepEqual(
    normalizeClientConfig({
      version: 1,
      auth: {
        aws_region: "us-west-2",
        user_pool_id: "pool",
        user_pool_client_id: "client",
      },
      data: { aws_region: "us-west-2", url: "https://graphql.example" },
      upload_api: { endpoint: "https://upload.example/" },
    }),
    {
      version: 1,
      auth: {
        region: "us-west-2",
        userPoolId: "pool",
        userPoolClientId: "client",
      },
      data: { region: "us-west-2", url: "https://graphql.example" },
      uploadApiUrl: "https://upload.example",
    },
  );
});

test("accepts an Amplify outputs file", () => {
  const config = normalizeClientConfig({
    auth: {
      aws_region: "us-west-2",
      user_pool_id: "pool",
      user_pool_client_id: "client",
    },
    data: { aws_region: "us-west-2", url: "https://graphql.example" },
    custom: { API: { myHttpApi: { endpoint: "https://upload.example/" } } },
  });
  assert.equal(config.uploadApiUrl, "https://upload.example");
});
