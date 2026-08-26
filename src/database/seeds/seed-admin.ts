import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'crypto';
import { Role } from '../../common/enums/role.enum';
import { StaffUser } from '../../modules/staff/staff-user.entity';
import { AppDataSource } from '../data-source';

/**
 * Админ бүртгэлийг `.env`-ээс үүсгэх / нууц үгийг сэргээх.
 *
 *   npm run seed:admin
 *
 * `.env` дэх утгууд:
 *   ADMIN_EMAIL     заавал биш (анхдагч admin@winfit.mn)
 *   ADMIN_PASSWORD  өгөөгүй бол санамсаргүй үүсгэж дэлгэц дээр хэвлэнэ
 *   ADMIN_NAME      заавал биш
 *
 * Бүртгэл АЛЬ ХЭДИЙН байвал нууц үгийг `.env`-ийнхээр СОЛИНО. Ингэснээр
 * нууц үгээ мартах гэж байхгүй — `.env` нь үргэлж үнэн эх сурвалж.
 *
 * ⚠ Production-д энэ зан төлөв АЮУЛТАЙ: `.env` алдагдвал админ рүү үүрд
 * хандах боломж үлдэнэ, мөн UI-аас сольсон нууц үгийг чимээгүй буцаана.
 * Тиймээс production-д сэргээхийг хориглоно — `ADMIN_FORCE_RESET=true`
 * гэж ил зөвшөөрсөн үед л ажиллана.
 */
async function main(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? 'admin@winfit.mn').toLowerCase().trim();
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');

  if (password.length < 8) {
    console.error('✗ ADMIN_PASSWORD хамгийн багадаа 8 тэмдэгт байх ёстой.');
    process.exit(1);
  }

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(StaffUser);
  const existing = await repo.findOne({ where: { email } });

  if (existing) {
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && process.env.ADMIN_FORCE_RESET !== 'true') {
      console.log(`ℹ  ${email} аль хэдийн байна — production тул СОЛИОГҮЙ.`);
      console.log('   Шаардвал ADMIN_FORCE_RESET=true гэж ил зөвшөөрнө үү.');
      await AppDataSource.destroy();
      return;
    }
    existing.passwordHash = await hash(password);
    // `.env`-ээс тавьсан нууц үгийг мэдэж байгаа тул солиулах шаардлагагүй.
    existing.mustChangePassword = false;
    if (existing.role !== Role.ADMIN) existing.role = Role.ADMIN;
    if (process.env.ADMIN_NAME) existing.name = process.env.ADMIN_NAME;
    await repo.save(existing);

    console.log('✓ Админы нууц үгийг .env-ийнхээр сэргээв');
    console.log(`   И-мэйл : ${email}`);
    if (generated) console.log(`   Нууц үг: ${password}`);
    else console.log('   Нууц үг: .env → ADMIN_PASSWORD');
    await AppDataSource.destroy();
    return;
  }

  await repo.save(
    repo.create({
      email,
      name: process.env.ADMIN_NAME ?? 'Админ',
      role: Role.ADMIN,
      passwordHash: await hash(password),
      // `.env`-д нууц үг бичсэн бол хэрэглэгч түүнийг мэднэ — эхний
      // нэвтрэлтэд солиулах нь дэмий саад. Санамсаргүй үүсгэсэн бол солино.
      mustChangePassword: generated,
    }),
  );

  console.log('✓ Админ үүслээ');
  console.log(`   И-мэйл : ${email}`);
  if (generated) {
    console.log(`   Нууц үг: ${password}`);
    console.log('   ⚠ Санамсаргүй үүсгэв — эхний нэвтрэлтэд солино.');
  } else {
    console.log('   Нууц үг: .env → ADMIN_PASSWORD');
  }

  await AppDataSource.destroy();
}

main().catch((e: unknown) => {
  console.error('✗ Seed амжилтгүй:', e instanceof Error ? e.message : e);
  process.exit(1);
});
