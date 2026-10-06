import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import energyRouter from "./energy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(energyRouter);

export default router;
