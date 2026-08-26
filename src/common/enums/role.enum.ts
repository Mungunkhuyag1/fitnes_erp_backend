/**
 * Ажилтны үүрэг. Салбарын ойлголт байхгүй тул энгийн 3 шатлал
 * (docs/01-integration-model.md §11 шийдвэр 1).
 */
export enum Role {
  RECEPTION = 'reception',
  MANAGER = 'manager',
  ADMIN = 'admin',
}

/** Эрхийн шатлал: admin > manager > reception. `@Roles`-ийн доод хязгаарт. */
export const ROLE_RANK: Record<Role, number> = {
  [Role.RECEPTION]: 1,
  [Role.MANAGER]: 2,
  [Role.ADMIN]: 3,
};

export const ROLE_LABEL: Record<Role, string> = {
  [Role.RECEPTION]: 'Ресепшн',
  [Role.MANAGER]: 'Менежер',
  [Role.ADMIN]: 'Админ',
};

/** `role` нь `min`-ээс дээш эсвэл тэнцүү эрхтэй эсэх. */
export function hasRole(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}
