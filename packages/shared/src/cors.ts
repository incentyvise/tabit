export function parseCorsOrigins(...sources: (string | undefined)[]): string[] {
  const origins = sources
    .flatMap((source) => (source ?? "").split(","))
    .map((origin) => origin.trim())
    .filter(Boolean);

  return [...new Set(origins)];
}

export function resolveCorsOrigins(): string[] {
  const origins = parseCorsOrigins(
    process.env.CORS_ORIGIN,
    process.env.NEXT_PUBLIC_PWA_URL,
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
    process.env.NEXT_PUBLIC_ADMIN_URL,
    "https://app.tabit.in",
    "https://admin.tabit.in",
  );

  return origins.length > 0 ? origins : ["http://localhost:3003"];
}
