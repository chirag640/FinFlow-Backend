// ─────────────────────────────────────────────────────────────────────────────
// Shared document shapes — all _id fields are cuid strings (never ObjectId)
// ─────────────────────────────────────────────────────────────────────────────

export type Role = "USER" | "ADMIN";

export interface UserDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  email: string;
  username: string; // unique, lowercase, set at registration
  usernameUpdatedAt?: Date | null;
  name: string; // stored encrypted
  avatarUrl?: string | null;
  passwordHash?: string | null;
  googleId?: string | null;
  role: Role;
  currency: string;
  monthlyBudget: number;
  emailVerified: boolean;
  otpCode?: string | null;
  otpExpiresAt?: Date | null;
  otpLastSentAt?: Date | null;
  passwordResetCode?: string | null;
  passwordResetExpiresAt?: Date | null;
  pinHash?: string | null; // SHA-256 of the user's 4-digit PIN; null = no PIN set
}

export interface RefreshTokenDoc {
  _id: string;
  createdAt: Date;
  token: string;
  expiresAt: Date;
  userId: string;
  lastUsedAt?: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceName?: string | null;
}

export interface PushDeviceDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
  disabledAt?: Date | null;

  userId: string;
  token: string;
  platform?: string | null;
}

export interface NotificationEventDoc {
  _id: string;
  createdAt: Date;
  expiresAt: Date;

  key: string;
  type: string;
  userId: string;
}

export interface ExpenseDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  amount: number;
  description: string;
  category: string;
  date: Date;
  notes?: string | null;
  isIncome: boolean;
  isRecurring: boolean;
  recurringRule?: string | null;
  recurringParentId?: string | null;
  userId: string;
}

export interface BudgetDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  categoryKey: string;
  allocatedAmount: number;
  month: number;
  year: number;
  carryForward: boolean;
  userId: string;
}

export interface GoalDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  title: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  deadline?: Date | null;
  colorIndex: number;
  userId: string;
}

export interface GroupDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  name: string;
  emoji: string;
  description?: string | null;
  ownerId: string;
}

export interface GroupMemberDoc {
  _id: string;
  createdAt: Date;
  name: string;
  username?: string | null;
  userId?: string | null;
  groupId: string;
}

export interface GroupExpenseDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  amount: number;
  description: string;
  date: Date;
  note?: string | null;
  paidByMemberId: string;
  splitType: string;
  shares: Array<{ memberId: string; amount: number }>;
  groupId: string;
  isSettlement?: boolean;
}

export interface SyncPushIdempotencyDoc {
  _id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  status: "processing" | "completed";
  response?: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}
