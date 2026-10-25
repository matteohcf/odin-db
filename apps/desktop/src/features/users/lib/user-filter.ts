import type { UserInfo } from "@odin-db/bindings";

/** Whether the user's name, database or one of its roles (`role@db`) contains the text. */
export function userMatches(user: UserInfo, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (needle === "") return true;
  return [user.user, user.db, ...user.roles.map((role) => `${role.role}@${role.db}`)].some(
    (value) => value.toLowerCase().includes(needle),
  );
}
