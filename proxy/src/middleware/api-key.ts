import { Request, Response, NextFunction } from "express";

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers["x-api-key"];
  const expectedKey = process.env.PROXY_API_KEY;

  if (!expectedKey) {
    res.status(500).json({ error: "PROXY_API_KEY not configured" });
    return;
  }

  if (apiKey !== expectedKey) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  next();
}
