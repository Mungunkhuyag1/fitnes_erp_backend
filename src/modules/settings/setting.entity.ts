import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Ажиллагааны тохиргоо — түлхүүр/утга.
 *
 * Код дотор биш DB-д байх шалтгаан: захиалагч өөрөө dashboard-аас өөрчилдөг
 * зүйлс (жиш. ресепшн бэлнээр сунгах эрхтэй эсэх). Deploy шаардахгүй.
 */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 80 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
