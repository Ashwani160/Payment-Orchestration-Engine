// Reads env once, at the edge. Pure code never touches process.env.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
} as const;