import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { verify as verifyJwt } from "jsonwebtoken";
import { ExtractJwt, Strategy } from "passport-jwt";
import { DatabaseService } from "../../../database/database.service";

interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

function resolveAccessSecrets(): string[] {
  const current = process.env.JWT_SECRET?.trim();
  if (!current) {
    throw new Error("JWT_SECRET environment variable is required");
  }

  const previous = (process.env.JWT_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0 && secret !== current);

  return [current, ...previous];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(private db: DatabaseService) {
    const accessSecrets = resolveAccessSecrets();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Rotation baseline: accept tokens signed with current or previous access secrets.
      secretOrKeyProvider: (_request, rawJwtToken, done) => {
        if (!rawJwtToken) {
          done(null, accessSecrets[0]);
          return;
        }

        for (const secret of accessSecrets) {
          try {
            verifyJwt(rawJwtToken, secret, { ignoreExpiration: true });
            done(null, secret);
            return;
          } catch {
            // Try next configured secret.
          }
        }

        done(null, accessSecrets[0]);
      },
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.db.users.findOne(
      {
        _id: payload.sub,
        deletedAt: null,
      },
      {
        projection: {
          _id: 1,
          email: 1,
          username: 1,
          name: 1,
          avatarUrl: 1,
          role: 1,
          currency: 1,
          emailVerified: 1,
          monthlyBudget: 1,
          deletedAt: 1,
          pinHash: 1,
          pinVerifierHash: 1,
        },
      },
    );
    if (!user) throw new UnauthorizedException("Token no longer valid");

    const hasPin = Boolean(user.pinVerifierHash || user.pinHash);
    const {
      pinHash: _pinHash,
      pinVerifierHash: _pinVerifierHash,
      ...safeUser
    } = user;
    return { ...safeUser, hasPin };
  }
}
