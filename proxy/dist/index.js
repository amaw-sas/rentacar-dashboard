"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const api_key_1 = require("./middleware/api-key");
const availability_1 = __importDefault(require("./localiza/availability"));
const reservation_1 = __importDefault(require("./localiza/reservation"));
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || "3001");
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Health check (no auth)
app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "rentacar-localiza-proxy" });
});
// Protected routes
app.use("/api/localiza/availability", api_key_1.apiKeyAuth, availability_1.default);
app.use("/api/localiza/reservation", api_key_1.apiKeyAuth, reservation_1.default);
app.listen(port, () => {
    console.log(`Localiza proxy running on port ${port}`);
});
