import express from "express";
import { identifyRouter } from "./routes/identify";

const app = express();

app.use(express.json());
app.use(identifyRouter);

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});

