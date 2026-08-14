import { describe, expect, test } from "bun:test";
import {
  applyCloudinaryBootstrap,
  CloudinaryAdminClient,
  PORTFOLIO_TRANSFORMATIONS,
  planCloudinaryBootstrap,
  railwayVariableCommand,
  validateBootstrapCredentials,
} from "./cloudinaryBootstrap";

const CREDENTIALS = {
  cloudName: "portfolio-cloud",
  apiKey: "123456789",
  apiSecret: "super-secret",
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function existingTransformation(name: string) {
  const transformation = PORTFOLIO_TRANSFORMATIONS.find(
    (candidate) => candidate.name === name
  )!;
  return {
    name: `t_${name}`,
    named: true,
    allowed_for_strict: true,
    info: transformation.info,
  };
}

describe("Cloudinary bootstrap validation", () => {
  test("accepts plausible credentials without exposing their values", () => {
    expect(validateBootstrapCredentials(CREDENTIALS)).toEqual([]);
  });

  test("rejects malformed names and control characters", () => {
    expect(
      validateBootstrapCredentials({
        cloudName: "https://not-a-cloud",
        apiKey: "key\nvalue",
        apiSecret: "",
      })
    ).toHaveLength(3);
  });

  test("derives exact closed transformations from the renderer variants", () => {
    expect(PORTFOLIO_TRANSFORMATIONS).toEqual([
      {
        name: "portfolio_avatar",
        definition: "c_fill,h_800,w_800/q_auto",
        info: [{ crop: "fill", height: 800, width: 800 }, { quality: "auto" }],
      },
      {
        name: "portfolio_card",
        definition: "c_fill,h_360,w_600/q_auto",
        info: [{ crop: "fill", height: 360, width: 600 }, { quality: "auto" }],
      },
      {
        name: "portfolio_wide",
        definition: "c_limit,w_1600/q_auto",
        info: [{ crop: "limit", width: 1600 }, { quality: "auto" }],
      },
    ]);
  });
});

describe("Cloudinary bootstrap planning", () => {
  test("plans only absent provider resources", async () => {
    const seen: string[] = [];
    const client = new CloudinaryAdminClient(CREDENTIALS, async (input) => {
      const path = new URL(String(input)).pathname;
      seen.push(path);
      if (path.endsWith("/ping")) return json({ status: "ok" });
      return json({ error: { message: "missing" } }, 404);
    });

    const operations = await planCloudinaryBootstrap(client);

    expect(operations.map((operation) => operation.kind)).toEqual([
      "create-upload-preset",
      "create-transformation",
      "create-transformation",
      "create-transformation",
    ]);
    expect(seen).toContain(
      "/v1_1/portfolio-cloud/transformations/t_portfolio_avatar"
    );
  });

  test("accepts matching existing resources without changing them", async () => {
    const client = new CloudinaryAdminClient(CREDENTIALS, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/ping")) return json({ status: "ok" });
      if (path.endsWith("/upload_presets/portfolio_owner_images")) {
        return json({
          name: "portfolio_owner_images",
          unsigned: false,
          settings: { disallow_public_id: false },
        });
      }
      const name = path.split("/t_").at(-1)!;
      return json(existingTransformation(name));
    });

    expect(await planCloudinaryBootstrap(client)).toEqual([]);
  });

  test("refuses to overwrite an unsigned preset", async () => {
    const client = new CloudinaryAdminClient(CREDENTIALS, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/ping")) return json({ status: "ok" });
      if (path.includes("upload_presets")) {
        return json({ name: "portfolio_owner_images", unsigned: true });
      }
      return json({ error: { message: "missing" } }, 404);
    });

    expect(planCloudinaryBootstrap(client)).rejects.toThrow(
      "Refusing to overwrite"
    );
  });

  test("refuses to overwrite a different transformation definition", async () => {
    const client = new CloudinaryAdminClient(CREDENTIALS, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/ping")) return json({ status: "ok" });
      if (path.includes("upload_presets")) {
        return json({ name: "portfolio_owner_images", unsigned: false });
      }
      return json({
        name: `t_${path.split("/t_").at(-1)}`,
        named: true,
        allowed_for_strict: true,
        info: [{ crop: "fill", height: 9000, width: 9000 }],
      });
    });

    expect(planCloudinaryBootstrap(client)).rejects.toThrow(
      "usage could not be proven empty"
    );
  });

  test("repairs a different transformation only when Cloudinary proves it unused", async () => {
    const writes: Array<{ path: string; body: string }> = [];
    const client = new CloudinaryAdminClient(
      CREDENTIALS,
      async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/ping")) return json({ status: "ok" });
        if (path.includes("upload_presets")) {
          return json({ name: "portfolio_owner_images", unsigned: false });
        }
        if (init?.method === "PUT") {
          writes.push({ path, body: String(init.body) });
          return json({ message: "updated" });
        }
        const name = path.split("/t_").at(-1)!;
        if (name === "portfolio_avatar") {
          return json({
            name: "t_portfolio_avatar",
            named: true,
            allowed_for_strict: false,
            info: [{ crop: "thumb", height: 100, width: 100 }],
            derived: [],
          });
        }
        return json(existingTransformation(name));
      }
    );

    const operations = await planCloudinaryBootstrap(client);
    expect(operations.map((operation) => operation.kind)).toEqual([
      "update-transformation",
    ]);

    await applyCloudinaryBootstrap(client, operations);
    expect(writes).toEqual([
      {
        path: "/v1_1/portfolio-cloud/transformations/t_portfolio_avatar",
        body: "unsafe_update=c_fill%2Ch_800%2Cw_800%2Fq_auto&allowed_for_strict=true",
      },
    ]);
  });

  test("never repairs a transformation with a derived asset", async () => {
    const client = new CloudinaryAdminClient(CREDENTIALS, async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/ping")) return json({ status: "ok" });
      if (path.includes("upload_presets")) {
        return json({ name: "portfolio_owner_images", unsigned: false });
      }
      return json({
        name: `t_${path.split("/t_").at(-1)}`,
        named: true,
        allowed_for_strict: true,
        info: [{ crop: "thumb", height: 100, width: 100 }],
        derived: [{ public_id: "already-used" }],
      });
    });

    expect(planCloudinaryBootstrap(client)).rejects.toThrow(
      "Refusing to overwrite"
    );
  });

  test("uses Basic auth without placing credentials in URLs", async () => {
    let inspectedUrl = "";
    let authorization = "";
    const client = new CloudinaryAdminClient(
      CREDENTIALS,
      async (input, init) => {
        inspectedUrl = String(input);
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        return json({ status: "ok" });
      }
    );

    await client.verifyCredentials();

    expect(inspectedUrl).not.toContain(CREDENTIALS.apiKey);
    expect(inspectedUrl).not.toContain(CREDENTIALS.apiSecret);
    expect(authorization).toBe(
      `Basic ${Buffer.from("123456789:super-secret").toString("base64")}`
    );
  });

  test("creates exact signed resources without sending credentials in bodies", async () => {
    const writes: Array<{ path: string; method: string; body: string }> = [];
    const client = new CloudinaryAdminClient(
      CREDENTIALS,
      async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (init?.method === "GET" && path.endsWith("/ping")) {
          return json({ status: "ok" });
        }
        if (init?.method === "GET") {
          return json({ error: { message: "missing" } }, 404);
        }
        writes.push({
          path,
          method: init?.method ?? "",
          body: String(init?.body ?? ""),
        });
        return json({ message: "created" });
      }
    );

    const operations = await planCloudinaryBootstrap(client);
    await applyCloudinaryBootstrap(client, operations);

    expect(writes).toHaveLength(4);
    expect(writes[0]).toEqual({
      path: "/v1_1/portfolio-cloud/upload_presets",
      method: "POST",
      body: "name=portfolio_owner_images&unsigned=false&disallow_public_id=false",
    });
    expect(writes[1]).toEqual({
      path: "/v1_1/portfolio-cloud/transformations/portfolio_avatar",
      method: "POST",
      body: "transformation=c_fill%2Ch_800%2Cw_800%2Fq_auto&allowed_for_strict=true",
    });
    for (const write of writes) {
      expect(write.path).not.toContain(CREDENTIALS.apiSecret);
      expect(write.body).not.toContain(CREDENTIALS.apiSecret);
    }
  });

  test("only enables Strict Transformations when definitions already match", async () => {
    const writes: string[] = [];
    const client = new CloudinaryAdminClient(
      CREDENTIALS,
      async (input, init) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/ping")) return json({ status: "ok" });
        if (path.includes("upload_presets")) {
          return json({ name: "portfolio_owner_images", unsigned: false });
        }
        if (init?.method === "PUT") {
          writes.push(`${init.method} ${path} ${String(init.body)}`);
          return json({ message: "updated" });
        }
        const name = path.split("/t_").at(-1)!;
        return json({
          ...existingTransformation(name),
          allowed_for_strict: false,
        });
      }
    );

    const operations = await planCloudinaryBootstrap(client);
    await applyCloudinaryBootstrap(client, operations);

    expect(writes).toEqual([
      "PUT /v1_1/portfolio-cloud/transformations/t_portfolio_avatar allowed_for_strict=true",
      "PUT /v1_1/portfolio-cloud/transformations/t_portfolio_card allowed_for_strict=true",
      "PUT /v1_1/portfolio-cloud/transformations/t_portfolio_wide allowed_for_strict=true",
    ]);
  });
});

describe("Railway secret transport", () => {
  test("uses stdin and never includes a value in command arguments", () => {
    const command = railwayVariableCommand("CLOUDINARY_API_SECRET");

    expect(command).toContain("--stdin");
    expect(command).toContain("--skip-deploys");
    expect(command).toContain("CLOUDINARY_API_SECRET");
    expect(command.join(" ")).not.toContain(CREDENTIALS.apiSecret);
  });
});
