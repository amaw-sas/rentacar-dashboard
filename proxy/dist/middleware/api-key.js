"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyAuth = apiKeyAuth;
function apiKeyAuth(req, res, next) {
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
