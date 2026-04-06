import { Injectable } from "@nestjs/common";

type MetricWindow = {
  pushLatenciesMs: number[];
  pullLatenciesMs: number[];
  queueDepthSamples: number[];
  pullStalenessMs: number[];
};

const WINDOW_LIMIT = 200;
const USER_WINDOW_LIMIT = 100;

type PullUserStat = {
  pulls: number;
  unchanged: number;
  lastAt: string;
};

@Injectable()
export class SyncMetricsService {
  private readonly window: MetricWindow = {
    pushLatenciesMs: [],
    pullLatenciesMs: [],
    queueDepthSamples: [],
    pullStalenessMs: [],
  };

  private pushTotal = 0;
  private pushErrors = 0;
  private pullTotal = 0;
  private pullErrors = 0;
  private pullUnchanged = 0;
  private retries = 0;
  private idempotentReplays = 0;
  private idempotencyHits = 0;
  private idempotencyMisses = 0;
  private idempotencyPurged = 0;
  private readonly pullByUser = new Map<string, PullUserStat>();

  recordPushSuccess(latencyMs: number, queueDepth: number): void {
    this.pushTotal += 1;
    this.addSample(this.window.pushLatenciesMs, latencyMs);
    this.addSample(this.window.queueDepthSamples, queueDepth);
  }

  recordPushError(latencyMs?: number): void {
    this.pushTotal += 1;
    this.pushErrors += 1;
    if (typeof latencyMs === "number") {
      this.addSample(this.window.pushLatenciesMs, latencyMs);
    }
  }

  recordPullSuccess(
    latencyMs: number,
    stalenessMs?: number,
    unchanged = false,
    userId?: string,
  ): void {
    this.pullTotal += 1;
    this.addSample(this.window.pullLatenciesMs, latencyMs);
    if (typeof stalenessMs === "number" && stalenessMs >= 0) {
      this.addSample(this.window.pullStalenessMs, stalenessMs);
    }
    if (unchanged) {
      this.pullUnchanged += 1;
    }
    this.recordPullUser(userId, unchanged);
  }

  recordPullError(latencyMs?: number): void {
    this.pullTotal += 1;
    this.pullErrors += 1;
    if (typeof latencyMs === "number") {
      this.addSample(this.window.pullLatenciesMs, latencyMs);
    }
  }

  recordRetry(count = 1): void {
    this.retries += Math.max(count, 0);
  }

  recordIdempotentReplay(): void {
    this.idempotentReplays += 1;
    this.recordRetry(1);
  }

  recordIdempotencyHit(): void {
    this.idempotencyHits += 1;
  }

  recordIdempotencyMiss(): void {
    this.idempotencyMisses += 1;
  }

  recordIdempotencyPurge(count: number): void {
    this.idempotencyPurged += Math.max(0, Math.round(count));
  }

  snapshot() {
    const pushP95 = this.p95(this.window.pushLatenciesMs);
    const pullP95 = this.p95(this.window.pullLatenciesMs);
    const queueDepthP95 = this.p95(this.window.queueDepthSamples);
    const stalenessP95 = this.p95(this.window.pullStalenessMs);

    const pushErrorRate = this.rate(this.pushErrors, this.pushTotal);
    const pullErrorRate = this.rate(this.pullErrors, this.pullTotal);

    const pullUnchangedRate = this.rate(this.pullUnchanged, this.pullTotal);

    const slos = {
      pushLatencyP95Ms: { target: 1500, current: pushP95 },
      pullLatencyP95Ms: { target: 1200, current: pullP95 },
      pullStalenessP95Ms: { target: 30_000, current: stalenessP95 },
      errorRate: {
        target: 0.02,
        pushCurrent: pushErrorRate,
        pullCurrent: pullErrorRate,
      },
      pullUnchangedRatio: {
        target: 0.6,
        current: pullUnchangedRate,
      },
    };

    const topPullUsers = [...this.pullByUser.entries()]
      .map(([userId, stat]) => ({
        userId,
        pulls: stat.pulls,
        unchanged: stat.unchanged,
        unchangedRatio: this.rate(stat.unchanged, stat.pulls),
        lastAt: stat.lastAt,
      }))
      .sort((a, b) => b.pulls - a.pulls)
      .slice(0, 20);

    return {
      counters: {
        pushTotal: this.pushTotal,
        pushErrors: this.pushErrors,
        pullTotal: this.pullTotal,
        pullErrors: this.pullErrors,
        pullUnchanged: this.pullUnchanged,
        retries: this.retries,
        idempotentReplays: this.idempotentReplays,
        idempotencyHits: this.idempotencyHits,
        idempotencyMisses: this.idempotencyMisses,
        idempotencyPurged: this.idempotencyPurged,
      },
      queue: {
        lastDepth: this.window.queueDepthSamples.at(-1) ?? 0,
        depthP95: queueDepthP95,
      },
      latency: {
        pushP95Ms: pushP95,
        pullP95Ms: pullP95,
      },
      staleness: {
        lastPullStalenessMs: this.window.pullStalenessMs.at(-1) ?? 0,
        pullStalenessP95Ms: stalenessP95,
      },
      errorRates: {
        push: pushErrorRate,
        pull: pullErrorRate,
      },
      ratios: {
        pullUnchanged: pullUnchangedRate,
      },
      topPullUsers,
      slos,
    };
  }

  private recordPullUser(userId?: string, unchanged = false): void {
    if (!userId) return;

    if (
      !this.pullByUser.has(userId) &&
      this.pullByUser.size >= USER_WINDOW_LIMIT
    ) {
      const oldestKey = this.pullByUser.keys().next().value;
      if (typeof oldestKey === "string") {
        this.pullByUser.delete(oldestKey);
      }
    }

    const current = this.pullByUser.get(userId) ?? {
      pulls: 0,
      unchanged: 0,
      lastAt: new Date(0).toISOString(),
    };

    current.pulls += 1;
    if (unchanged) {
      current.unchanged += 1;
    }
    current.lastAt = new Date().toISOString();

    this.pullByUser.set(userId, current);
  }

  private addSample(bucket: number[], value: number): void {
    bucket.push(Math.max(0, Math.round(value)));
    if (bucket.length > WINDOW_LIMIT) {
      bucket.splice(0, bucket.length - WINDOW_LIMIT);
    }
  }

  private p95(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
    );
    return sorted[index];
  }

  private rate(failures: number, total: number): number {
    if (total === 0) return 0;
    return Number((failures / total).toFixed(4));
  }
}
