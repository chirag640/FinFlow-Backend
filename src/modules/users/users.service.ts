import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { createHash } from "crypto";
import { AUTH_CONFIG } from "../../common/constants";
import { EncryptionService } from "../../common/services/encryption.service";
import { DatabaseService } from "../../database/database.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

type UserProfileUpdateSet = Partial<UpdateProfileDto> & {
  updatedAt: Date;
  usernameUpdatedAt?: Date;
  name?: string;
};

@Injectable()
export class UsersService {
  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
  ) {}

  private readonly logger = new Logger(UsersService.name);

  async findById(id: string) {
    const user = await this.db.users.findOne({ _id: id, deletedAt: null });
    if (!user) throw new NotFoundException("User not found");
    const safe = { ...user };
    delete safe.passwordHash;
    delete safe.otpCode;
    delete safe.otpExpiresAt;
    delete safe.pinHash;
    delete safe.pinSalt;
    delete safe.pinVerifierHash;
    delete safe.pinFailedAttempts;
    delete safe.pinLockedUntil;
    delete safe.pinLastFailedAt;
    return { ...safe, id: safe._id, name: this.safeDecryptName(safe.name) };
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const user = await this.db.users.findOne({ _id: id, deletedAt: null });
    if (!user) throw new NotFoundException("User not found");

    const updateData: UserProfileUpdateSet = { ...dto, updatedAt: new Date() };

    if (dto.username && dto.username !== user.username) {
      const username = dto.username.trim().toLowerCase();
      const minNextChangeAt = user.usernameUpdatedAt
        ? new Date(
            new Date(user.usernameUpdatedAt).getTime() +
              30 * 24 * 60 * 60 * 1000,
          )
        : null;

      if (minNextChangeAt && new Date() < minNextChangeAt) {
        throw new BadRequestException(
          `Username can be changed once every 30 days. Next change allowed after ${minNextChangeAt.toISOString()}`,
        );
      }

      const existing = await this.db.users.findOne({
        username,
        deletedAt: null,
        _id: { $ne: id },
      });
      if (existing) throw new ConflictException("Username already taken");

      updateData.username = username;
      updateData.usernameUpdatedAt = new Date();
    }

    if (dto.name) updateData.name = this.encryption.encrypt(dto.name);
    await this.db.users.updateOne({ _id: id }, { $set: updateData });
    return this.findById(id);
  }

  async updatePin(id: string, pinHash: string | null) {
    if (pinHash === undefined) {
      throw new BadRequestException(
        "pinHash is required (use null to clear PIN)",
      );
    }

    const now = new Date();
    const normalized = pinHash ? this.normalizePinHash(pinHash) : null;

    await this.db.users.updateOne(
      { _id: id },
      {
        $set: {
          pinHash: null,
          pinSalt: normalized?.salt ?? null,
          pinVerifierHash: normalized
            ? await bcrypt.hash(
                normalized.canonicalHash,
                AUTH_CONFIG.BCRYPT_ROUNDS_PIN,
              )
            : null,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          pinLastFailedAt: null,
          updatedAt: now,
        },
      },
    );
  }

  async verifyPin(id: string, pin: string) {
    const normalizedPin = pin.trim();

    const user = await this.db.users.findOne(
      { _id: id, deletedAt: null },
      {
        projection: {
          _id: 1,
          pinHash: 1,
          pinSalt: 1,
          pinVerifierHash: 1,
          pinFailedAttempts: 1,
          pinLockedUntil: 1,
        },
      },
    );
    if (!user) throw new NotFoundException("User not found");

    const now = new Date();
    const lockedUntil = user.pinLockedUntil
      ? new Date(user.pinLockedUntil)
      : null;
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) {
      return {
        valid: false,
        remainingAttempts: 0,
        lockedUntil: lockedUntil.toISOString(),
      };
    }

    const hasVerifier = !!user.pinVerifierHash;
    const hasLegacyHash = !!user.pinHash;
    if (!hasVerifier && !hasLegacyHash) {
      return {
        valid: false,
        remainingAttempts: 0,
      };
    }

    const isValid = await this.verifyPinWithStoredData(normalizedPin, {
      pinVerifierHash: user.pinVerifierHash ?? null,
      pinSalt: user.pinSalt ?? null,
      pinHash: user.pinHash ?? null,
    });

    if (isValid) {
      const resetSet: Record<string, unknown> = {
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLastFailedAt: null,
        updatedAt: now,
      };

      if (user.pinHash) {
        const normalizedLegacy = this.normalizePinHash(user.pinHash);
        resetSet.pinSalt = normalizedLegacy.salt;
        resetSet.pinVerifierHash = await bcrypt.hash(
          normalizedLegacy.canonicalHash,
          AUTH_CONFIG.BCRYPT_ROUNDS_PIN,
        );
        resetSet.pinHash = null;
      }

      await this.db.users.updateOne(
        { _id: id },
        {
          $set: resetSet,
        },
      );
      return { valid: true };
    }

    const failedAttempts = (user.pinFailedAttempts ?? 0) + 1;
    const threshold = AUTH_CONFIG.PIN_MAX_FAILED_ATTEMPTS;
    let nextLockedUntil: Date | null = null;
    let remainingAttempts = Math.max(0, threshold - failedAttempts);

    if (failedAttempts >= threshold) {
      const exponent = Math.max(0, failedAttempts - threshold);
      const lockSeconds = Math.min(
        AUTH_CONFIG.PIN_LOCK_MAX_SECONDS,
        AUTH_CONFIG.PIN_LOCK_BASE_SECONDS * Math.pow(2, exponent),
      );
      nextLockedUntil = new Date(now.getTime() + lockSeconds * 1000);
      remainingAttempts = 0;
    }

    await this.db.users.updateOne(
      { _id: id },
      {
        $set: {
          pinFailedAttempts: failedAttempts,
          pinLockedUntil: nextLockedUntil,
          pinLastFailedAt: now,
          updatedAt: now,
        },
      },
    );

    return {
      valid: false,
      remainingAttempts,
      lockedUntil: nextLockedUntil?.toISOString() ?? null,
    };
  }

  async deleteAccount(id: string) {
    const now = new Date();
    const suffix = `${id}_${now.getTime()}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const tombstoneEmail = `deleted+${suffix}@finflow.local`;
    const tombstoneUsername = `deleted_${suffix}`;

    await Promise.all([
      this.db.refreshTokens.deleteMany({ userId: id }),
      this.db.pushDevices.deleteMany({ userId: id }),
      this.db.notificationEvents.deleteMany({ userId: id }),
    ]);
    const result = await this.db.users.updateOne(
      { _id: id, deletedAt: null },
      {
        $set: {
          deletedAt: now,
          updatedAt: now,
          email: tombstoneEmail,
          username: tombstoneUsername,
          emailVerified: false,
          otpCode: null,
          otpExpiresAt: null,
          otpLastSentAt: null,
          passwordResetCode: null,
          passwordResetExpiresAt: null,
          pinHash: null,
          pinSalt: null,
          pinVerifierHash: null,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
          pinLastFailedAt: null,
        },
      },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException("User not found or already deleted");
    }
  }

  async searchByUsername(query: string) {
    if (!query || query.length < 2) return [];
    // Escape regex special characters to prevent injection
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await this.db.users
      .find({
        username: { $regex: `^${escaped}`, $options: "i" },
        deletedAt: null,
      })
      .limit(10)
      .toArray();
    return users.map((u) => ({
      id: u._id,
      username: u.username,
      name: this.safeDecryptName(u.name),
    }));
  }

  private sha256(input: string): string {
    return createHash("sha256").update(input).digest("hex");
  }

  private normalizePinHash(pinHash: string): {
    salt: string | null;
    canonicalHash: string;
  } {
    const normalized = pinHash.trim().toLowerCase();
    const separator = normalized.indexOf(":");

    if (separator === 32 && normalized.length === 97) {
      const salt = normalized.substring(0, 32);
      const digest = normalized.substring(33);
      return { salt, canonicalHash: `${salt}:${digest}` };
    }

    return { salt: null, canonicalHash: normalized };
  }

  private canonicalPinHashFromInput(pin: string, salt: string | null): string {
    if (salt) {
      return `${salt}:${this.sha256(`${salt}${pin}`)}`;
    }
    return this.sha256(pin);
  }

  private async verifyPinWithStoredData(
    pin: string,
    stored: {
      pinVerifierHash: string | null;
      pinSalt: string | null;
      pinHash: string | null;
    },
  ): Promise<boolean> {
    if (stored.pinVerifierHash) {
      const candidate = this.canonicalPinHashFromInput(pin, stored.pinSalt);
      return bcrypt.compare(candidate, stored.pinVerifierHash);
    }

    if (stored.pinHash) {
      return this.matchesPin(pin, stored.pinHash);
    }

    return false;
  }

  private matchesPin(pin: string, storedHash: string): boolean {
    const separator = storedHash.indexOf(":");
    if (separator === 32 && storedHash.length === 97) {
      const salt = storedHash.substring(0, 32);
      const expected = storedHash.substring(33);
      return this.sha256(`${salt}${pin}`) === expected;
    }
    return this.sha256(pin) === storedHash;
  }

  private safeDecryptName(value: string): string {
    try {
      return this.encryption.decrypt(value);
    } catch (error) {
      this.logger.error(
        "Failed to decrypt user name payload",
        error instanceof Error ? error.stack : undefined,
      );
      return "[REDACTED]";
    }
  }
}
