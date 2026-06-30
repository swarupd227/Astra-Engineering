import { defineConfig } from "drizzle-kit";

if (!process.env.MYSQL_HOST) {
  throw new Error("MYSQL_HOST environment variable is required");
}
if (!process.env.MYSQL_USER) {
  throw new Error("MYSQL_USER environment variable is required");
}
if (!process.env.MYSQL_PASSWORD) {
  throw new Error("MYSQL_PASSWORD environment variable is required");
}
if (!process.env.MYSQL_DATABASE) {
  throw new Error("MYSQL_DATABASE environment variable is required");
}

export default defineConfig({
  out: "./migrations-mysql",
  schema: "./shared/schema-mysql.ts",
  dialect: "mysql",
  strict: true,
  verbose: true,
  dbCredentials: {
    host: process.env.MYSQL_HOST,
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    ssl: {
      rejectUnauthorized: false,
    },
  },
});
