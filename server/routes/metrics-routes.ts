import { Express, Request, Response } from "express";
import { db } from "../db";
import { sql } from "drizzle-orm";

/**
 * Register metrics-related routes
 * @param app - Express application instance
 */
export function registerMetricsRoutes(app: Express) {
  app.get("/api/metrics", async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;

      let query = sql`
        SELECT 
          use_case as use_case,
          COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() AS percentage
        FROM artifact_events
      `;

      if (startDate && endDate) {
        query = sql`${query} WHERE created_at >= ${startDate} AND created_at < DATE_ADD(${endDate}, INTERVAL 1 DAY)`;
      }

      query = sql`${query} GROUP BY use_case`;

      const results = await db.execute(query);

      // db.execute returns a raw result, usually an array of rows in the first element for mysql2
      const rows = Array.isArray(results) ? (Array.isArray(results[0]) ? results[0] : results) : [];

      res.json(rows);
    } catch (error) {
      console.error("[Metrics API] Failed to fetch metrics:", error);
      res.status(500).json({ message: "Failed to fetch usage metrics" });
    }
  });
}
