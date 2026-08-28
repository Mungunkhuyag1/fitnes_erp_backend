import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AUDIENCE_LABEL,
  PackageAudience,
} from '../../common/enums/audience.enum';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import {
  CreatePackageDto,
  ListPackagesDto,
  UpdatePackageDto,
} from './dto/package.dto';
import { Package } from './package.entity';

export interface PackageView {
  id: string;
  name: string;
  days: number;
  price: number;
  audience: PackageAudience;
  audienceLabel: string;
  requiresProof: boolean;
  firstTimeOnly: boolean;
  seats: number;
  online: boolean;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
}

@Injectable()
export class PackageService {
  constructor(
    @InjectRepository(Package) private readonly repo: Repository<Package>,
  ) {}

  async list(q: ListPackagesDto): Promise<PageResult<PackageView>> {
    const qb = this.repo.createQueryBuilder('p');
    if (q.active !== undefined) {
      qb.andWhere('p.active = :active', { active: q.active });
    }
    // Багцыг ажилтан өөрөө эрэмбэлдэг тул `sortOrder` эхэлж, дараа нь үнэ.
    qb.orderBy('p.sort_order', 'ASC').addOrderBy('p.price', 'ASC');

    const [rows, total] = await qb
      .skip(q.skip)
      .take(q.take)
      .getManyAndCount();
    return pageResult(rows.map((r) => this.view(r)), total, q);
  }

  async get(id: string): Promise<PackageView> {
    return this.view(await this.find(id));
  }

  async create(dto: CreatePackageDto): Promise<PackageView> {
    await this.assertNameFree(dto.name);
    const saved = await this.repo.save(
      this.repo.create({
        name: dto.name.trim(),
        days: dto.days,
        price: String(dto.price),
        sortOrder: dto.sortOrder ?? 0,
        audience: dto.audience ?? PackageAudience.STANDARD,
        requiresProof: dto.requiresProof ?? false,
        firstTimeOnly: dto.firstTimeOnly ?? false,
        seats: dto.seats ?? 1,
        online: dto.online ?? true,
      }),
    );
    return this.view(saved);
  }

  async update(id: string, dto: UpdatePackageDto): Promise<PackageView> {
    const p = await this.find(id);
    if (dto.name !== undefined && dto.name.trim() !== p.name) {
      await this.assertNameFree(dto.name, id);
      p.name = dto.name.trim();
    }
    // Хугацаа/үнэ өөрчлөгдөхөд АЛЬ ХЭДИЙН зарагдсан гишүүнчлэл хөндөгдөхгүй —
    // `memberships` дэвтэрт тухайн үеийн `days`/`amount` хуулбарлагдсан байдаг.
    if (dto.days !== undefined) p.days = dto.days;
    if (dto.price !== undefined) p.price = String(dto.price);
    if (dto.sortOrder !== undefined) p.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) p.active = dto.active;
    if (dto.audience !== undefined) p.audience = dto.audience;
    if (dto.requiresProof !== undefined) p.requiresProof = dto.requiresProof;
    if (dto.firstTimeOnly !== undefined) p.firstTimeOnly = dto.firstTimeOnly;
    if (dto.seats !== undefined) p.seats = dto.seats;
    if (dto.online !== undefined) p.online = dto.online;
    return this.view(await this.repo.save(p));
  }

  /** Устгахгүй — идэвхгүй болгоно (түүхэн холбоос хэвээр). */
  async deactivate(id: string): Promise<PackageView> {
    const p = await this.find(id);
    p.active = false;
    return this.view(await this.repo.save(p));
  }

  /** Дотоод хэрэглээ — сунгалт тооцоход (B5). */
  async findActiveOrFail(id: string): Promise<Package> {
    const p = await this.find(id);
    if (!p.active) throw new NotFoundException('Багц идэвхгүй байна');
    return p;
  }

  private async find(id: string): Promise<Package> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Багц олдсонгүй');
    return p;
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { name: name.trim() } });
    if (existing && existing.id !== exceptId) {
      throw new ConflictException('Ийм нэртэй багц бүртгэлтэй байна');
    }
  }

  private view(p: Package): PackageView {
    return {
      id: p.id,
      name: p.name,
      days: p.days,
      // `bigint` нь драйвераас string ирдэг — гадагш тоо болгож өгнө.
      price: Number(p.price),
      audience: p.audience,
      audienceLabel: AUDIENCE_LABEL[p.audience] ?? p.audience,
      requiresProof: p.requiresProof,
      firstTimeOnly: p.firstTimeOnly,
      seats: p.seats,
      online: p.online,
      active: p.active,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
    };
  }
}
