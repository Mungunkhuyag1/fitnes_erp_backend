import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Facebook Page-ийн чат — WinFit доторх хайрцаг.
 *
 * ★ ГУРВАН ХҮСНЭГТ
 *
 *  · «meta_pages»         — холболтын тохиргоо (нэг мөр хангалттай)
 *  · «meta_conversations» — хүн тус бүрийн яриа
 *  · «meta_messages»      — мессеж бүр
 *
 * ★ ЯАГААД ТУСДАА ХҮСНЭГТ, «settings» БИШ ВЭ
 *
 * Холболт нь НУУЦ УТГА агуулна (page access token, app secret). Тэдгээр
 * нь «devices.password_enc»-тэй ижил аргаар битүүмжлэгдэх ёстой
 * (`common/utils/secret-box.ts`). «settings» нь jsonb-д ил хадгалдаг ба
 * 60 секунд кэшлэдэг — нууц утгад тохирохгүй.
 *
 * ★ PSID ГЭЖ ЮУ ВЭ
 *
 * Page-Scoped ID: нэг хүн ХУУДАС БҮРД өөр дугаартай байна. Facebook-ийн
 * жинхэнэ хэрэглэгчийн ID БИШ. Тиймээс `(page_id, psid)` хосоор л
 * давтагдашгүй.
 *
 * ⚠ Messenger нь УТАСНЫ ДУГААР өгдөггүй. Гишүүнтэй холбохыг ажилтан
 * ГАРААР хийнэ («member_id») — автоматаар таних арга байхгүй.
 */
export class MetaInbox1788180000000 implements MigrationInterface {
  name = 'MetaInbox1788180000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "meta_pages" (
        "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
        /* Facebook Page ID — Meta-гийн өгсөн тоон мөр. */
        "page_id"        varchar(40) NOT NULL,
        "page_name"      varchar(200),
        /* ⚠ Битүүмжилсэн. Түүхийгээр нь ХЭЗЭЭ Ч хадгалахгүй. */
        "token_enc"      text,
        "app_secret_enc" text,
        /*
         * Webhook баталгаажуулалтын үг. Энэ нь НУУЦ БИШ — Meta-гийн
         * хяналтын самбар дээр ил бичигддэг ба зөвхөн «энэ хаяг минийх
         * мөн» гэдгийг батлахад ашиглагдана.
         */
        "verify_token"   varchar(120),
        "active"         boolean NOT NULL DEFAULT true,
        "connected_at"   timestamptz,
        "connected_by"   uuid,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "updated_at"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_meta_pages" PRIMARY KEY ("id"),
        CONSTRAINT "uq_meta_page_id" UNIQUE ("page_id"),
        CONSTRAINT "fk_meta_pages_staff" FOREIGN KEY ("connected_by")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);

    await q.query(`
      CREATE TABLE "meta_conversations" (
        "id"                uuid NOT NULL DEFAULT gen_random_uuid(),
        "page_id"           varchar(40) NOT NULL,
        "psid"              varchar(64) NOT NULL,
        "name"              varchar(200),
        "picture_url"       varchar(500),
        /* Гишүүнтэй ГАРААР холбоно — Messenger утас өгдөггүй. */
        "member_id"         uuid,
        "last_message_at"   timestamptz,
        "last_message_text" varchar(500),
        /*
         * ⚠ ЗӨВХӨН ИРСЭН мессеж энэ утгыг шинэчилнэ.
         *
         * Хариу бичих 24 цагийн цонх нь хэрэглэгч сүүлд бичсэнээс
         * тоологддог. Манай хариу түүнийг сунгахгүй — эс бөгөөс
         * хариулсаар байж цонхыг мөнхөд нээлттэй байлгаж болно.
         *
         * Дуусах агшныг ХАДГАЛАХГҮЙ, тооцоолно: дүрэм өөрчлөгдвөл
         * хадгалсан утга худлаа болно.
         */
        "last_inbound_at"   timestamptz,
        /* Уншаагүйн ТОО — bool биш: «3 шинэ мессеж» гэдэг мэдээлэлтэй. */
        "unread"            int NOT NULL DEFAULT 0,
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_meta_conversations" PRIMARY KEY ("id"),
        CONSTRAINT "uq_meta_conv" UNIQUE ("page_id", "psid"),
        CONSTRAINT "fk_meta_conv_member" FOREIGN KEY ("member_id")
          REFERENCES "members"("id") ON DELETE SET NULL
      )
    `);

    // Хайрцаг нь ҮРГЭЛЖ сүүлийн мессежээр эрэмбэлэгдэнэ.
    await q.query(`
      CREATE INDEX "ix_meta_conv_recent"
        ON "meta_conversations" ("last_message_at" DESC)
    `);
    await q.query(`
      CREATE INDEX "ix_meta_conv_member" ON "meta_conversations" ("member_id")
        WHERE "member_id" IS NOT NULL
    `);

    await q.query(`
      CREATE TABLE "meta_messages" (
        "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
        "conversation_id" uuid NOT NULL,
        /*
         * Meta-гийн мессежийн дугаар («mid»).
         *
         * ⚠ ДАВХАРДЛЫГ ХААХ ТҮЛХҮҮР. Meta нь webhook-ийг 200 хариу
         * авахгүй бол ДАХИН илгээдэг. Мөн өөрсдийн илгээсэн мессеж
         * «message_echoes»-оор буцаж ирдэг.
         */
        "mid"             varchar(200) NOT NULL,
        /* 'in' = хэрэглэгчээс, 'out' = хуудаснаас */
        "direction"       varchar(3) NOT NULL,
        "text"            varchar(2000),
        /* Зураг, дуу, файл — Meta-гийн өгсөн хэлбэрээр. */
        "attachments"     jsonb,
        /*
         * Хэн хариулсан бэ. «null» = Business Suite эсвэл утаснаас
         * бичсэн («message_echoes»-оор ирсэн) — WinFit мэдэхгүй.
         */
        "staff_user_id"   uuid,
        /* Илгээхэд алдаа гарвал энд. Мөр нь ҮЛДЭНЭ — чимээгүй алдагдахгүй. */
        "error"           varchar(500),
        "sent_at"         timestamptz NOT NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_meta_messages" PRIMARY KEY ("id"),
        CONSTRAINT "uq_meta_mid" UNIQUE ("mid"),
        CONSTRAINT "fk_meta_msg_conv" FOREIGN KEY ("conversation_id")
          REFERENCES "meta_conversations"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_meta_msg_staff" FOREIGN KEY ("staff_user_id")
          REFERENCES "staff_users"("id") ON DELETE SET NULL
      )
    `);

    await q.query(`
      CREATE INDEX "ix_meta_msg_thread"
        ON "meta_messages" ("conversation_id", "sent_at")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "meta_messages"`);
    await q.query(`DROP TABLE "meta_conversations"`);
    await q.query(`DROP TABLE "meta_pages"`);
  }
}
