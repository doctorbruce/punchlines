export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateAccount(username: string, name: string, password: unknown): string | null {
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) return "账号需为 3–32 位字母、数字、下划线、短横线或点，以字母或数字开头";
  if (!name || name.length > 24) return "称呼需为 1–24 个字符";
  return validatePassword(password);
}

export function validatePassword(value: unknown): string | null {
  return typeof value === "string" && value.length >= 10 && value.length <= 128
    ? null : "密码需为 10–128 个字符";
}
