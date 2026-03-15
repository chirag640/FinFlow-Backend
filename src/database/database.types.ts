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

export type InvestmentType =
  | "mutualFund"
  | "fixedDeposit"
  | "recurringDeposit"
  | "gold"
  | "realEstate"
  | "stock";

export interface InvestmentDoc {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;

  userId: string;
  type: InvestmentType;
  name: string;
  /** Total amount invested / principal */
  investedAmount: number;
  /** Current market value (manually entered) */
  currentValue: number;
  startDate: Date;
  maturityDate?: Date | null;
  /** Annual interest rate % — for FD / RD */
  interestRate?: number | null;
  /** Units for MF, grams for gold, shares for stocks */
  quantity?: number | null;
  /** Purchase price per unit / gram / share */
  purchasePrice?: number | null;
  /** Current price per unit / gram / share */
  currentPrice?: number | null;
  notes?: string | null;
}
