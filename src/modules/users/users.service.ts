import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";

@Injectable()
export class UsersService {
  constructor(
    private db: DatabaseService,
    private encryption: EncryptionService,
  ) {}

  async findById(id: string) {
    const user = await this.db.users.findOne({ _id: id, deletedAt: null });
    if (!user) throw new NotFoundException("User not found");
    const { passwordHash, otpCode, otpExpiresAt, ...safe } = user;
    return { ...safe, id: safe._id, name: this.encryption.decrypt(safe.name) };
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const user = await this.db.users.findOne({ _id: id, deletedAt: null });
    if (!user) throw new NotFoundException("User not found");

    const updateData: Record<string, any> = { ...dto, updatedAt: new Date() };

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
    await this.db.users.updateOne(
      { _id: id },
      { $set: { pinHash: pinHash ?? null, updatedAt: new Date() } },
    );
  }

  async deleteAccount(id: string) {
    await this.db.refreshTokens.deleteMany({ userId: id });
    await this.db.users.updateOne(
      { _id: id },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
    );
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
      name: this.encryption.decrypt(u.name),
    }));
  }
}
