import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import { PageQueryDto } from '../../common/dto/pagination.dto';
import { Role, ROLE_LABEL } from '../../common/enums/role.enum';
import { AuthService, hashPassword } from '../auth/auth.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { PasswordResetRequest } from './password-reset-request.entity';
import { StaffUser } from './staff-user.entity';

@Injectable()
export class StaffService {
  private readonly log = new Logger(StaffService.name);

  constructor(
    @InjectRepository(StaffUser)
    private readonly repo: Repository<StaffUser>,
    private readonly auth: AuthService,
    @InjectRepository(PasswordResetRequest)
    private readonly resets: Repository<PasswordResetRequest>,
  ) {}

  async list(q: PageQueryDto): Promise<PageResult<ReturnType<StaffService['view']>>> {
    const [rows, total] = await this.repo.findAndCount({
      order: { createdAt: 'ASC' },
      skip: q.skip,
      take: q.take,
    });
    return pageResult(rows.map((r) => this.view(r)), total, q);
  }

  async create(dto: CreateStaffDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.repo.findOne({ where: { email } })) {
      throw new ConflictException('Энэ и-мэйл хаяг бүртгэлтэй байна');
    }
    const saved = await this.repo.save(
      this.repo.create({
        email,
        name: dto.name.trim(),
        role: dto.role,
        passwordHash: await hashPassword(dto.password),
        // Түр нууц үг — эхний нэвтрэлтэд солихыг албадана (v1-д мэйл байхгүй).
        mustChangePassword: true,
      }),
    );
    return this.view(saved);
  }

  async update(id: string, dto: UpdateStaffDto) {
    const user = await this.find(id);

    // Сүүлийн идэвхтэй админыг унтраах / дүрийг нь буулгахыг хориглоно —
    // эс тэгвээс системд орох админгүй үлдэнэ.
    const losesAdmin =
      user.role === Role.ADMIN &&
      ((dto.role !== undefined && dto.role !== Role.ADMIN) ||
        dto.active === false);
    if (losesAdmin && (await this.countOtherActiveAdmins(id)) === 0) {
      throw new BadRequestException(
        'Сүүлийн админыг өөрчлөх боломжгүй — өөр админ томилсны дараа хийнэ үү',
      );
    }

    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.active !== undefined) user.active = dto.active;
    const saved = await this.repo.save(user);

    // Эрх нь буурсан эсвэл идэвхгүй болсон бол сессийг нь тэр дор нь таслана.
    if (dto.role !== undefined || dto.active === false) {
      await this.auth.revokeAllFor(id);
    }
    return this.view(saved);
  }

  async resetPassword(id: string, password: string) {
    const user = await this.find(id);
    user.passwordHash = await hashPassword(password);
    user.mustChangePassword = true;
    await this.repo.save(user);
    await this.auth.revokeAllFor(id);
    // Нууц үг тавигдсан тул нээлттэй хүсэлт нь утгагүй болно — хаана.
    // Эс бөгөөс жагсаалтад үлдэж, админ дахин дахин харна.
    await this.resets.update(
      { staffUserId: id, resolvedAt: IsNull() },
      { resolvedAt: new Date() },
    );
    return { ok: true, message: 'Түр нууц үг тавигдлаа. Ажилтанд дамжуулна уу.' };
  }

  // ══════════════════════════════════════════════════════════════
  //  Нууц үг сэргээх хүсэлт
  // ══════════════════════════════════════════════════════════════

  /**
   * Ажилтан «нууц үгээ мартсан» гэж мэдэгдэх.
   *
   * ★ ҮРГЭЛЖ АМЖИЛТТАЙ гэж хариулна — и-мэйл бүртгэлтэй эсэхийг ил
   * болговол хэн ч ажилтны хаягийг таамаглан олох боломжтой болно.
   * Бүртгэлгүй хаягаас ирсэн хүсэлтийг ч ХАДГАЛНА: админ хэн буруу
   * хаягаар оролдож байгааг харах нь ашигтай.
   */
  async requestReset(email: string, note: string | null, ip: string | null) {
    const clean = email.toLowerCase().trim();
    const user = await this.repo.findOne({ where: { email: clean } });

    const open = await this.resets.findOne({
      where: { email: clean, resolvedAt: IsNull() },
    });
    if (open) {
      // Аль хэдийн нээлттэй хүсэлттэй — шинийг үүсгэхгүй, гэхдээ
      // хэрэглэгчид ялгаа мэдэгдэхгүй.
      return { ok: true };
    }

    await this.resets.save(
      this.resets.create({
        email: clean,
        staffUserId: user?.id ?? null,
        note: note?.trim() || null,
        ip,
      }),
    );
    this.log.warn(`Нууц үг сэргээх хүсэлт: ${clean}`);
    return { ok: true };
  }

  /** Шийдэгдээгүй хүсэлтүүд — админы дэлгэцэд. */
  async listResets() {
    const rows = await this.resets.find({
      where: { resolvedAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      staffUserId: r.staffUserId,
      note: r.note,
      createdAt: r.createdAt,
      /** Бүртгэлгүй хаяг — админ анхаарах ёстой. */
      unknown: !r.staffUserId,
    }));
  }

  async resolveReset(id: string, staffId: string) {
    await this.resets.update(
      { id },
      { resolvedAt: new Date(), resolvedBy: staffId },
    );
    return { ok: true };
  }

  private async find(id: string): Promise<StaffUser> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Ажилтан олдсонгүй');
    return user;
  }

  private countOtherActiveAdmins(exceptId: string): Promise<number> {
    return this.repo.count({
      where: { id: Not(exceptId), role: Role.ADMIN, active: true },
    });
  }

  view(u: StaffUser) {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role],
      active: u.active,
      mustChangePassword: u.mustChangePassword,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }
}
