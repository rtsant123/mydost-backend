import { buildServer } from "./server";

const start = async () => {
  const app = buildServer();
  const port = app.env.PORT;
  app.log.info({ claudeKeyPresent: Boolean(app.env.CLAUDE_API_KEY) }, "Claude key presence");

  try {
    await app.listen({ port, host: "0.0.0.0" });
    app.log.info(`API listening on ${port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
