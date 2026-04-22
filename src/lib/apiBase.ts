export function apiUrl(path: string) {
  const base = import.meta.env.VITE_API_BASE_URL?.trim();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalizedPath;
  return `${base.replace(/\/+$/, "")}${normalizedPath}`;
}
