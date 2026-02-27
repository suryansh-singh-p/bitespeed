import express from "express";
import { identifyRouter } from "./routes/identify";

const app = express();

app.use(express.json());
app.use(identifyRouter);

app.listen(3000, () => {
  // eslint-disable-next-line no-console
  console.log("Server listening on http://localhost:3000");
});

