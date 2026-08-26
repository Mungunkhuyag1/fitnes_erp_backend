import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { ROLE_LABEL } from '../../common/enums/role.enum';
import { StaffUser } from '../staff/staff-user.entity';
import { RefreshToken } from './refresh-token.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

/** Нууц үгийг argon2id-ээр hash хийх — сан бүхэлдээ энэ функцээр дамжина. */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @InjectRepository(StaffUser)
    private readonly staff: Repository<StaffUser>,
    @InjectRepository(RefreshToken)
    private readonly tokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Нэвтрэх ──

  async login(email: string, password: string, ctx: LoginContext) {
    const user = await this.staff.findOne({
      where: { email: email.toLowerCase().trim() },
    });

    // Хэрэглэгч байхгүй ч argon2-г ажиллуулж хугацааг тэнцүүлнэ — хариу
    // ирэх хугацаагаар «энэ и-мэйл бүртгэлтэй юу» гэдгийг тандахаас сэргийлнэ.
    const ok = user
      ? await this.safeVerify(user.passwordHash, password)
      : await this.dummyVerify(password);

    if (!user || !ok) {
      throw new UnauthorizedException('И-мэйл эсвэл нууц үг буруу байна');
    }
    if (!user.active) {
      throw new UnauthorizedException('Таны бүртгэл идэвхгүй байна');
    }

    await this.staff.update(user.id, { lastLoginAt: new Date() });
    const pair = await this.issue(user, ctx);
    return { ...pair, user: this.view(user) };
  }

  // ── Токен шинэчлэх (rotation) ──

  async refresh(rawToken: string, ctx: LoginContext): Promise<TokenPair> {
    const row = await this.tokens.findOne({
      where: { tokenHash: this.hashToken(rawToken) },
    });
    if (!row) throw new UnauthorizedException('Токен олдсонгүй');

    if (row.revokedAt) {
      // Хүчингүй болсон токеныг дахин ашиглах гэж оролдож байна — токен
      // алдагдсан байж болзошгүй. Тухайн ажилтны БҮХ сессийг таслана.
      this.log.warn(
        `Хүчингүй refresh токен дахин ашиглагдав — бүх сесс таслав (staff=${row.staffUserId})`,
      );
      await this.revokeAllFor(row.staffUserId);
      throw new UnauthorizedException('Токен хүчингүй — дахин нэвтэрнэ үү');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Токены хугацаа дууссан');
    }

    const user = await this.staff.findOne({ where: { id: row.staffUserId } });
    if (!user?.active) throw new UnauthorizedException('Бүртгэл идэвхгүй');

    await this.tokens.update(row.id, { revokedAt: new Date() });
    return this.issue(user, ctx);
  }

  async logout(rawToken: string): Promise<void> {
    await this.tokens.update(
      { tokenHash: this.hashToken(rawToken) },
      { revokedAt: new Date() },
    );
  }

  // ── Нууц үг солих ──

  /**
   * Өөрийн профайлыг засах.
   *
   * И-мэйл, ЭРХИЙГ энд өөрчлөхгүй — тэдгээр нь аюулгүй байдлын хил.
   * Ажилтан өөрийгөө админ болгож чадах ёсгүй, и-мэйл нь нэвтрэх түлхүүр
   * тул зөвхөн админ (staff удирдлагаас) солино.
   */
  async profile(userId: string) {
    const user = await this.staff.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Хэрэглэгч олдсонгүй');
    return this.view(user);
  }

  async updateProfile(userId: string, dto: { name?: string; avatar?: string }) {
    const user = await this.staff.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Хэрэглэгч олдсонгүй');

    if (dto.name !== undefined) user.name = dto.name.trim();
    // Хоосон мөр = зургийг УСТГАХ.
    if (dto.avatar !== undefined) user.avatar = dto.avatar || null;
    await this.staff.save(user);
    // `view()`-ээр буцаана — нэвтрэх хариутай ЯГ ижил бүтэц, тиймээс
    // клиент тал хоёр өөр хэлбэр зохицуулах шаардлагагүй.
    return this.view(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.staff.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    if (!(await this.safeVerify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Одоогийн нууц үг буруу байна');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('Шинэ нууц үг хуучинтайгаа ижил байна');
    }

    await this.staff.update(user.id, {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    });
    // Нууц үг солиход бусад бүх сесс тасарна (хэрэв хэн нэгэн нэвтэрсэн байсан бол).
    await this.revokeAllFor(user.id);
  }

  /**
   * Тухайн ажилтны БҮХ идэвхтэй сессийг таслах.
   *
   * `revokedAt: IsNull()` — `undefined` бичвэл TypeORM тэр нөхцөлийг алгасаад
   * шинэчлэлт огт хийхгүй байсан (нууц үг солиход хуучин токен ажилласаар
   * үлддэг байв). Идэвхтэй мөрийг тодорхой заана.
   */
  async revokeAllFor(staffUserId: string): Promise<number> {
    const res = await this.tokens.update(
      { staffUserId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return res.affected ?? 0;
  }

  view(user: StaffUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      roleLabel: ROLE_LABEL[user.role],
      avatar: user.avatar,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
    };
  }

  // ── Дотоод ──

  private async issue(user: StaffUser, ctx: LoginContext): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, typ: 'access' },
      {
        secret: this.config.getOrThrow<string>('jwt.secret'),
        // `expiresIn` нь `ms` санны нарийн literal төрөлтэй ('15m' гэх мэт).
        // Утга env-ээс ирдэг тул compile үед шалгах боломжгүй — cast хийнэ.
        expiresIn: (this.config.get<string>('jwt.accessTtl') ??
          '15m') as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    await this.tokens.save(
      this.tokens.create({
        staffUserId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs()),
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        ip: ctx.ip ?? null,
      }),
    );
    return { accessToken, refreshToken };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** `30d`, `12h`, `45m` хэлбэрийг мс болгоно. */
  private refreshTtlMs(): number {
    const ttl = this.config.get<string>('jwt.refreshTtl') ?? '30d';
    const m = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!m) return 30 * 86_400_000;
    const n = Number(m[1]);
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]!;
    return n * unit;
  }

  private async safeVerify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }

  /** Хэрэглэгч олдоогүй үед ч ижил хэмжээний ажил хийж хугацааг тэнцүүлнэ. */
  private async dummyVerify(plain: string): Promise<boolean> {
    const DUMMY =
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$3pQm3nJZ8Xw9r0kR7yZ1qL5vH2bN4cV6mT8sD0fG1aE';
    await this.safeVerify(DUMMY, plain);
    return false;
  }
}
