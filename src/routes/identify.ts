import { Router } from "express";
import { identifyController } from "../controllers/identifyController";

export const identifyRouter = Router();

identifyRouter.post("/identify", identifyController);

