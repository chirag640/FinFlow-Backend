#!/usr/bin/env node
import { performance } from "node:perf_hooks";

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;

    const eq = token.indexOf("=");
    if (eq >= 0) {
      parsed[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      i += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? "http://localhost:3000/api/v1/health";
  const method = (args.method ?? "GET").toUpperCase();
  const requests = Math.max(1, asNumber(args.requests, 300));
  const concurrency = Math.max(1, asNumber(args.concurrency, 20));
  const timeoutMs = Math.max(100, asNumber(args.timeoutMs, 8000));
  const maxErrorRate = Math.max(0, asNumber(args.maxErrorRate, 0.05));
  const maxP95Ms = Math.max(1, asNumber(args.maxP95Ms, 1200));

  const latencies = [];
  let nextIndex = 0;
  let success = 0;
  let failed = 0;
  const statusCounts = new Map();

  const startedAt = performance.now();

  async function runWorker() {
    while (true) {
      const requestIndex = nextIndex;
      nextIndex += 1;
      if (requestIndex >= requests) return;

      const requestStart = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          signal: controller.signal,
        });
        await response.arrayBuffer();
        clearTimeout(timeout);

        const elapsed = Math.round(performance.now() - requestStart);
        latencies.push(elapsed);

        const key = String(response.status);
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);

        if (response.status >= 200 && response.status < 400) {
          success += 1;
        } else {
          failed += 1;
        }
      } catch {
        clearTimeout(timeout);
        const elapsed = Math.round(performance.now() - requestStart);
        latencies.push(elapsed);
        failed += 1;
        statusCounts.set("error", (statusCounts.get("error") ?? 0) + 1);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));

  const totalMs = Math.max(1, Math.round(performance.now() - startedAt));
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const errorRate = failed / Math.max(1, requests);
  const rps = Number(((requests * 1000) / totalMs).toFixed(2));

  const summary = {
    scenario: {
      url,
      method,
      requests,
      concurrency,
      timeoutMs,
    },
    totals: {
      durationMs: totalMs,
      rps,
      success,
      failed,
      errorRate: Number(errorRate.toFixed(4)),
    },
    latencyMs: {
      p50,
      p95,
      p99,
      max: latencies.length > 0 ? Math.max(...latencies) : 0,
    },
    statuses: Object.fromEntries(statusCounts.entries()),
    gates: {
      maxErrorRate,
      maxP95Ms,
      passed: errorRate <= maxErrorRate && p95 <= maxP95Ms,
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!summary.gates.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Load test runner failed", error);
  process.exitCode = 1;
});
