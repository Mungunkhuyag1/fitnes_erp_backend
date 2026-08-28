/**
 * Багцын зорилтот бүлэг.
 *
 * Заалны үнийн самбар нь ХОЁР тэнхлэгтэй: хугацаа (хоног) ба хэн болох.
 * Ижил 30 хоног нь энгийн хүнд 250,000₮, оюутанд 160,000₮, ахмадад
 * 150,000₮ байна.
 *
 * Энэ утга нь хоёр зүйлийг шийднэ:
 *   • Дэлгэц дээр багцыг хэрхэн бүлэглэх
 *   • Худалдан авалт нь баталгаажуулалт шаардах эсэх (`requiresProof`)
 */
export enum PackageAudience {
  /** Хүн бүрд нээлттэй. */
  STANDARD = 'standard',
  /** Оюутан, сурагч — үнэмлэх шаардана. */
  STUDENT = 'student',
  /** Ахмад настан — үнэмлэх шаардана. */
  SENIOR = 'senior',
  /** Хотхоны оршин суугч — оршин суух баримт шаардана. */
  RESIDENT = 'resident',
  /** Хосын багц — 2 суудалтай, ресепшнээр зарагдана. */
  COUPLE = 'couple',
}

/** Дэлгэцэд харуулах нэр. */
export const AUDIENCE_LABEL: Record<PackageAudience, string> = {
  [PackageAudience.STANDARD]: 'Энгийн',
  [PackageAudience.STUDENT]: 'Оюутан, сурагч',
  [PackageAudience.SENIOR]: 'Ахмад настан',
  [PackageAudience.RESIDENT]: 'Хотхоны оршин суугч',
  [PackageAudience.COUPLE]: 'Хосын багц',
};
