import express from "express";
import { routes } from "./routes.js";

export function createServer() {
  const app = express();
  app.use(express.json());
  app.use(routes);
  return app;
}