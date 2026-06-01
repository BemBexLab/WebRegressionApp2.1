import { Router } from "express";
import websiteRoutes from "./websites";
import pageRoutes from "./pages";
import scanRoutes from "./scans";
import statsRoutes from "./stats";

const router = Router();

router.use("/stats", statsRoutes);
router.use("/websites", websiteRoutes);
router.use("/websites/:websiteId/pages", pageRoutes);
router.use("/websites/:websiteId/scans", scanRoutes);

export default router;
