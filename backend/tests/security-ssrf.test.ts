import { describe, expect, it } from "vitest";
import { SourceValidator, isNonPublicHost, isNonPublicIpv4, isNonPublicIpv6, validateDnsResolution } from "../src/modules/sources/SourceValidator.js";
import { RobotsPolicyService } from "../src/modules/sources/RobotsPolicyService.js";
import { MemoryRateLimiter } from "../src/common/rateLimiter.js";
import { ExportRepository } from "../src/db/repositories/export.repository.js";
import type { PrismaClient } from "@prisma/client";
import path from "node:path";
import os from "node:os";

describe("PHASE 16 — Production Security & Hardening", () => {
  const validator = new SourceValidator();

  describe("SSRF Protection — Host and IP Classification", () => {
    it("blocks localhost, loopback, and local network representations", () => {
      expect(isNonPublicHost("localhost")).toBe(true);
      expect(isNonPublicHost("sub.localhost")).toBe(true);
      expect(isNonPublicHost("127.0.0.1")).toBe(true);
      expect(isNonPublicHost("127.0.0.2")).toBe(true);
      expect(isNonPublicHost("127.128.0.1")).toBe(true);
      expect(isNonPublicHost("0.0.0.0")).toBe(true);
      expect(isNonPublicHost("::1")).toBe(true);
      expect(isNonPublicHost("::")).toBe(true);
    });

    it("blocks Cloud Metadata endpoints and hostnames (AWS, GCP, Azure)", () => {
      // AWS / GCP / Azure IPv4 Link-Local metadata
      expect(isNonPublicHost("169.254.169.254")).toBe(true);
      expect(isNonPublicHost("169.254.1.1")).toBe(true);
      expect(isNonPublicIpv4("169.254.169.254")).toBe(true);

      // AWS EC2 IPv6 Metadata endpoint
      expect(isNonPublicHost("fd00:ec2::254")).toBe(true);
      expect(isNonPublicIpv6("fd00:ec2::254")).toBe(true);

      // Cloud Metadata hostnames
      expect(isNonPublicHost("metadata.google.internal")).toBe(true);
      expect(isNonPublicHost("metadata.google")).toBe(true);
      expect(isNonPublicHost("metadata")).toBe(true);
      expect(isNonPublicHost("instance-data")).toBe(true);
    });

    it("blocks internal single-label service names in container networks", () => {
      expect(isNonPublicHost("redis")).toBe(true);
      expect(isNonPublicHost("mysql")).toBe(true);
      expect(isNonPublicHost("database")).toBe(true);
      expect(isNonPublicHost("api")).toBe(true);
      expect(isNonPublicHost("worker")).toBe(true);
      expect(isNonPublicHost("backend")).toBe(true);
      expect(isNonPublicHost("internal")).toBe(true);
    });

    it("blocks private RFC 1918 and CGNAT IP ranges", () => {
      // 10.0.0.0/8
      expect(isNonPublicHost("10.0.0.1")).toBe(true);
      expect(isNonPublicHost("10.254.254.254")).toBe(true);

      // 172.16.0.0/12
      expect(isNonPublicHost("172.16.0.1")).toBe(true);
      expect(isNonPublicHost("172.31.255.255")).toBe(true);
      expect(isNonPublicHost("172.20.10.5")).toBe(true);

      // 192.168.0.0/16
      expect(isNonPublicHost("192.168.0.1")).toBe(true);
      expect(isNonPublicHost("192.168.1.100")).toBe(true);

      // 100.64.0.0/10 (CGNAT)
      expect(isNonPublicHost("100.64.0.1")).toBe(true);
      expect(isNonPublicHost("100.100.100.100")).toBe(true);
    });

    it("blocks IPv4-mapped and IPv4-compatible IPv6 addresses for internal destinations", () => {
      expect(isNonPublicHost("::ffff:127.0.0.1")).toBe(true);
      expect(isNonPublicHost("::ffff:169.254.169.254")).toBe(true);
      expect(isNonPublicHost("::ffff:10.0.0.1")).toBe(true);
      expect(isNonPublicHost("::ffff:192.168.1.1")).toBe(true);
      expect(isNonPublicIpv6("::ffff:127.0.0.1")).toBe(true);
      expect(isNonPublicIpv6("::ffff:169.254.169.254")).toBe(true);
    });

    it("blocks internal / testing TLDs", () => {
      expect(isNonPublicHost("service.local")).toBe(true);
      expect(isNonPublicHost("app.internal")).toBe(true);
      expect(isNonPublicHost("intranet.corp")).toBe(true);
      expect(isNonPublicHost("gateway.lan")).toBe(true);
      expect(isNonPublicHost("device.home")).toBe(true);
      expect(isNonPublicHost("portal.localdomain")).toBe(true);
      expect(isNonPublicHost("host.docker.internal")).toBe(true);
      expect(isNonPublicHost("kubernetes.default.svc.cluster.local")).toBe(true);
    });

    it("allows valid public Internet domains and public IPs", () => {
      expect(isNonPublicHost("example.com")).toBe(false);
      expect(isNonPublicHost("api.github.com")).toBe(false);
      expect(isNonPublicHost("sub.domain.co.uk")).toBe(false);
      expect(isNonPublicHost("93.184.215.14")).toBe(false); // example.com IPv4
      expect(isNonPublicHost("1.1.1.1")).toBe(false); // Cloudflare DNS
      expect(isNonPublicHost("8.8.8.8")).toBe(false); // Google DNS
    });
  });

  describe("SSRF Protection — SourceValidator Normalization", () => {
    it("rejects SSRF attempts in URL normalization", () => {
      expect(validator.normalize("http://127.0.0.1/admin")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://169.254.169.254/latest/meta-data")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://[fd00:ec2::254]/latest/meta-data")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://metadata.google.internal/computeMetadata/v1/")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://redis:6379/")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://mysql:3306/")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://10.0.0.5/api")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://192.168.1.1/router")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
      expect(validator.normalize("http://[::1]/debug")).toMatchObject({ code: "NON_PUBLIC_HOST_BLOCKED" });
    });

    it("normalizes and allows legitimate public source URLs", () => {
      const result = validator.normalize("https://example.org/articles/ai-trends?utm_source=twitter&id=123");
      expect("canonicalUrl" in result).toBe(true);
      if ("canonicalUrl" in result) {
        expect(result.domain).toBe("example.org");
        expect(result.canonicalUrl).toBe("https://example.org/articles/ai-trends?id=123");
      }
    });
  });

  describe("SSRF Protection — DNS Resolution Preflight", () => {
    it("detects and blocks direct non-public IPs via DNS resolution validator", async () => {
      const res1 = await validateDnsResolution("127.0.0.1");
      expect(res1.safe).toBe(false);

      const res2 = await validateDnsResolution("169.254.169.254");
      expect(res2.safe).toBe(false);

      const res3 = await validateDnsResolution("localhost");
      expect(res3.safe).toBe(false);

      const res4 = await validateDnsResolution("redis");
      expect(res4.safe).toBe(false);
    });

    it("validates direct public IP successfully", async () => {
      const res = await validateDnsResolution("8.8.8.8");
      expect(res.safe).toBe(true);
    });
  });

  describe("SSRF Protection — RobotsPolicyService Outbound Fetch Guard", () => {
    it("fails closed and blocks robots check on SSRF target without making HTTP calls", async () => {
      let fetchCalled = false;
      const robots = new RobotsPolicyService({
        fetcher: async () => {
          fetchCalled = true;
          return { status: 200, text: async () => "User-agent: *\nAllow: /" };
        },
      });

      const result = await robots.check("http://169.254.169.254/latest/meta-data");
      expect(result.allowed).toBe(false);
      expect(result.status).toBe("DISALLOWED");
      expect(result.reason).toContain("SSRF protection blocked");
      expect(fetchCalled).toBe(false);
    });

    it("blocks robots check on localhost", async () => {
      let fetchCalled = false;
      const robots = new RobotsPolicyService({
        fetcher: async () => {
          fetchCalled = true;
          return { status: 200, text: async () => "User-agent: *\nAllow: /" };
        },
      });

      const result = await robots.check("http://localhost:3000/api");
      expect(result.allowed).toBe(false);
      expect(result.status).toBe("DISALLOWED");
      expect(fetchCalled).toBe(false);
    });
  });

  describe("Rate Limiting Guard", () => {
    it("enforces sliding window rate limit and calculates accurate retryAfter", () => {
      const limiter = new MemoryRateLimiter(60_000, 3);
      const key = "test-client-1";

      const r1 = limiter.check(key, 1000);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.check(key, 2000);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.check(key, 3000);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);

      // 4th request exceeds limit
      const r4 = limiter.check(key, 4000);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterSeconds).toBeGreaterThan(0);

      limiter.destroy();
    });
  });

  describe("Export Path Traversal Prevention", () => {
    it("rejects path traversal attempts that resolve outside storage directory", async () => {
      const storageDir = path.resolve(os.tmpdir(), "aidp-test-exports");
      const fakePrisma = {
        workspaceMember: {
          findUnique: async () => ({ status: "ACTIVE" }),
        },
        exportJob: {
          findFirst: async () => ({
            id: "job-123",
            workspaceId: "ws-1",
            status: "COMPLETED",
            format: "CSV",
            fileKey: "../../etc/passwd",
          }),
        },
      } as unknown as PrismaClient;

      const repo = new ExportRepository(fakePrisma, storageDir);
      await expect(
        repo.getExportJobForDownload("ws-1", "job-123", "user-1"),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "ACCESS_DENIED",
      });
    });
  });
});
