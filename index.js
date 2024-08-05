const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const NodeCache = require("node-cache");
const multer = require("multer");
const FormData = require("form-data");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;
const MIT_BASE = process.env.MIT_BASE || "http://127.0.0.1";
console.log(process.env);
const MIT_URLS = [`${MIT_BASE}:5001`, `${MIT_BASE}:5002`, `${MIT_BASE}:5003`, `${MIT_BASE}:5004`];
let currentServerIndex = 0;

const imageCache = new NodeCache({ stdTTL: 3600 }); // 1 hour
const requestLimitCache = new NodeCache({ stdTTL: 86400 }); // 1 day

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only images are allowed"));
    }
    cb(null, true);
  }
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get("/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).send("The URL parameter is required.");
  }

  const cachedImage = imageCache.get(imageUrl);

  if (cachedImage) {
    return res.set("Content-Type", cachedImage.contentType).send(cachedImage.body);
  }

  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const body = Buffer.from(response.data, "binary");
    const contentType = response.headers["content-type"];
    const originalSize = Buffer.byteLength(body);

    if (originalSize <= 2 * 1024 * 1024) {
      imageCache.set(imageUrl, { body, contentType });
      return res.set("Content-Type", contentType).send(body);
    }

    const compressedBuffer = await sharp(body).toFormat("jpeg").jpeg({ quality: 80 }).toBuffer();

    imageCache.set(imageUrl, {
      body: compressedBuffer,
      contentType: "image/jpeg"
    });

    res.set("Content-Type", "image/jpeg").send(compressedBuffer);
  } catch (err) {
    res.status(500).send("Unable to retrieve the image. Please try again later.");
  }
});

app.post("/submit", upload.single("file"), async (req, res) => {
  const userIp = req.ip;
  const { detector, direction, translator, tgt_lang } = req.body;

  const requestCount = requestLimitCache.get(userIp) || 0;
  if (requestCount >= 100) {
    console.log("User reached limit");
    return res.status(429).send("You have reached your daily limit. Please try again tomorrow.");
  }
  // Increment request count
  requestLimitCache.set(userIp, requestCount + 1);

  if (!req.file) {
    console.log("User has no file");
    return res.status(400).send("A file is required for submission.");
  }

  try {
    const formData = new FormData();

    formData.append("file", req.file.buffer, req.file.originalname);
    formData.append("detector", detector);
    formData.append("direction", direction);
    formData.append("translator", translator);
    formData.append("tgt_lang", tgt_lang);

    currentServerIndex = (currentServerIndex + 1) % MIT_URLS.length;
    const serverUrl = MIT_URLS[currentServerIndex];

    const response = await axios.post(`${serverUrl}/submit`, formData, {
      headers: formData.getHeaders()
    });

    const { task_id: taskId } = response.data;

    res.json({ taskId, s: currentServerIndex });
  } catch (err) {
    console.log(err);
    res.status(500).send("An error occurred during submission. Please try again later.");
  }
});

app.get("/task-state", async (req, res) => {
  const taskId = req.query.taskid;
  const currentServerIndex = req.query.s;

  if (!taskId) {
    return res.status(400).send("The taskId parameter is required.");
  }

  try {
    const serverUrl = MIT_URLS[currentServerIndex];

    const response = await axios.get(`${serverUrl}/task-state`, {
      params: {
        taskid: taskId
      }
    });

    if (response.data.state.includes("error")) {
      console.log({ taskId });
      console.log(response.data);
    }

    res.json(response.data);
  } catch (err) {
    console.log(err);
    res
      .status(500)
      .send("An error occurred while retrieving the task state. Please try again later.");
  }
});

app.get("/result/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const serverUrl = MIT_URLS[0];

    const response = await axios.get(`${serverUrl}/result/${taskId}`, {
      responseType: "arraybuffer"
    });

    const contentType = response.headers["content-type"];
    const body = Buffer.from(response.data, "binary");

    res.set("Content-Type", contentType).send(body);
  } catch (err) {
    console.log(err);
    res.status(500).send("Unable to retrieve the result image. Please try again later.");
  }
});

app.get("/input/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const serverUrl = MIT_URLS[0];

    const response = await axios.get(`${serverUrl}/input/${taskId}`, {
      responseType: "arraybuffer"
    });

    const contentType = response.headers["content-type"];
    const body = Buffer.from(response.data, "binary");

    res.set("Content-Type", contentType).send(body);
  } catch (err) {
    console.log(err);
    res.status(500).send("Unable to retrieve the result image. Please try again later.");
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server started http://127.0.0.1:${PORT}`);
});
