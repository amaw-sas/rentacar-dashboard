import express from "express";
import cors from "cors";
import { apiKeyAuth } from "./middleware/api-key";
import availabilityRouter from "./localiza/availability";
import reservationRouter from "./localiza/reservation";

const app = express();
const port = parseInt(process.env.PORT || "3001");

app.use(cors());
app.use(express.json());

// Health check (no auth)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "rentacar-localiza-proxy" });
});

// Protected routes
app.use("/api/localiza/availability", apiKeyAuth, availabilityRouter);
app.use("/api/localiza/reservation", apiKeyAuth, reservationRouter);

app.listen(port, () => {
  console.log(`Localiza proxy running on port ${port}`);
});
