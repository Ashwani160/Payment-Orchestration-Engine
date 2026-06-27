import Redis from "ioredis";
import { config } from "../config.js";

// One shared connection for the process.
export const redis = new Redis(config.redisUrl);