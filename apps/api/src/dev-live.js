if (process.env.NODE_ENV === "production") {
  throw new Error("Use npm start for production.");
}
if (process.env.MSC_DEV_FIXTURES === "1") {
  throw new Error("Remove MSC_DEV_FIXTURES before starting live development.");
}
process.env.NODE_ENV = "development";
process.env.SERVE_STATIC = "true";
// This command intentionally uses the normal .env, database and Discord services.
require("./index");
