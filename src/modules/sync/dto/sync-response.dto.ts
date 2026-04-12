import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class SyncEntityAckDto {
  @ApiProperty({ type: [String] })
  appliedUpserts: string[];

  @ApiProperty({ type: [String] })
  appliedDeletions: string[];

  @ApiProperty({ type: [String] })
  skippedUpserts: string[];

  @ApiProperty({ type: [String] })
  skippedDeletions: string[];
}

export class SyncPushAckDto {
  @ApiProperty({ type: SyncEntityAckDto })
  expenses: SyncEntityAckDto;

  @ApiProperty({ type: SyncEntityAckDto })
  budgets: SyncEntityAckDto;

  @ApiProperty({ type: SyncEntityAckDto })
  goals: SyncEntityAckDto;
}

export class SyncPushSyncedDto {
  @ApiProperty({ example: 12 })
  expenses: number;

  @ApiProperty({ example: 4 })
  budgets: number;

  @ApiProperty({ example: 3 })
  goals: number;
}

export class SyncPushResponseDto {
  @ApiProperty({ example: 1 })
  syncVersion: number;

  @ApiProperty({ type: SyncPushSyncedDto })
  synced: SyncPushSyncedDto;

  @ApiProperty({ type: SyncPushAckDto })
  ack: SyncPushAckDto;

  @ApiProperty({ example: "2026-04-11T12:20:00.000Z" })
  timestamp: string;
}

export class SyncPullUserDto {
  @ApiProperty({ example: "6b516f67-f4b4-4ab0-84e8-d7fdd86e4cb8" })
  id: string;

  @ApiProperty({ example: "Jane Doe" })
  name: string;

  @ApiProperty({ example: "jane@example.com" })
  email: string;

  @ApiPropertyOptional({
    nullable: true,
    example: "https://example.com/avatar.jpg",
  })
  avatarUrl?: string | null;

  @ApiProperty({ example: "INR" })
  currency: string;

  @ApiProperty({ example: 50000 })
  monthlyBudget: number;

  @ApiProperty({ example: true })
  emailVerified: boolean;
}

export class SyncPullResponseDto {
  @ApiProperty({ example: 1 })
  syncVersion: number;

  @ApiProperty({ type: [Object] })
  expenses: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  budgets: Record<string, unknown>[];

  @ApiProperty({ type: [Object] })
  goals: Record<string, unknown>[];

  @ApiPropertyOptional({ type: SyncPullUserDto, nullable: true })
  user?: SyncPullUserDto | null;

  @ApiProperty({ example: "2026-04-11T12:21:00.000Z" })
  serverTime: string;

  @ApiPropertyOptional({ example: 30000 })
  suggestedPullDelayMs?: number;

  @ApiPropertyOptional({ example: false })
  unchanged?: boolean;
}

export class SyncTelemetryAnomalyDto {
  @ApiProperty({ example: "sync_push_error_rate_high" })
  code: string;

  @ApiProperty({ example: "critical" })
  severity: "warning" | "critical";

  @ApiProperty({ example: "Push error rate is above threshold" })
  message: string;

  @ApiProperty({ example: 0.08 })
  observed: number;

  @ApiProperty({ example: 0.05 })
  threshold: number;

  @ApiProperty({ example: "ratio" })
  unit: "ratio" | "ms" | "count";
}

export class SyncTelemetryIdempotencyDto {
  @ApiProperty({ example: 86400000 })
  ttlMs: number;

  @ApiProperty({ example: 0 })
  expiredBacklog: number;
}

export class SyncTelemetryResponseDto {
  @ApiProperty({ type: Object })
  counters: Record<string, unknown>;

  @ApiProperty({ type: Object })
  queue: Record<string, unknown>;

  @ApiProperty({ type: Object })
  latency: Record<string, unknown>;

  @ApiProperty({ type: Object })
  staleness: Record<string, unknown>;

  @ApiProperty({ type: Object })
  errorRates: Record<string, unknown>;

  @ApiProperty({ type: Object })
  ratios: Record<string, unknown>;

  @ApiProperty({ type: [Object] })
  topPullUsers: Record<string, unknown>[];

  @ApiProperty({ type: Object })
  slos: Record<string, unknown>;

  @ApiProperty({ type: SyncTelemetryIdempotencyDto })
  idempotency: SyncTelemetryIdempotencyDto;

  @ApiProperty({ type: [SyncTelemetryAnomalyDto] })
  anomalies: SyncTelemetryAnomalyDto[];
}
