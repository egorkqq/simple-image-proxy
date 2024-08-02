const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const app = express();
const NodeCache = require("node-cache");
const multer = require("multer");
const FormData = require("form-data");

const MIT_URL = process.env.MIT_URL || "http://127.0.0.1:5004";
const PORT = process.env.PORT || 3000;

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
    return res.status(400).send("URL param is required");
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
    res.status(500).send("Cant get image");
  }
});

app.post("/submit", upload.single("file"), async (req, res) => {
  const userIp = req.ip;
  const { detector, direction, translator, tgt_lang } = req.body;

  const requestCount = requestLimitCache.get(userIp) || 0;
  if (requestCount >= 10) {
    return res.status(429).send("Daily limit reached");
  }
  // Increment request count
  requestLimitCache.set(userIp, requestCount + 1);

  if (!req.file) {
    return res.status(400).send("File is required");
  }

  try {
    const formData = new FormData();

    formData.append("file", req.file.buffer, req.file.originalname);
    formData.append("detector", detector);
    formData.append("direction", direction);
    formData.append("translator", translator);
    formData.append("tgt_lang", tgt_lang);

    const response = await axios.post(`${MIT_URL}/submit`, formData, {
      headers: formData.getHeaders()
    });

    const { task_id: taskId } = response.data;

    res.json({ taskId });
  } catch (err) {
    console.log(err);
    res.status(500).send("Error when submit");
  }
});

app.get("/task-state", async (req, res) => {
  const taskId = req.query.taskid;

  if (!taskId) {
    return res.status(400).send("taskId is required");
  }

  try {
    const response = await axios.get(`${MIT_URL}/task-state`, {
      params: {
        taskid: taskId
      }
    });

    res.json(response.data);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error when handling state");
  }
});

app.get("/result/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const response = await axios.get(`${MIT_URL}/result/${taskId}`, {
      responseType: "arraybuffer"
    });

    const contentType = response.headers["content-type"];
    const body = Buffer.from(response.data, "binary");

    res.set("Content-Type", contentType).send(body);
  } catch (err) {
    console.log(err);
    res.status(500).send("Cant get image");
  }
});

app.get("/input/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const response = await axios.get(`${MIT_URL}/input/${taskId}`, {
      responseType: "arraybuffer"
    });

    const contentType = response.headers["content-type"];
    const body = Buffer.from(response.data, "binary");

    res.set("Content-Type", contentType).send(body);
  } catch (err) {
    console.log(err);
    res.status(500).send("Cant get image");
  }
});

app.listen(PORT, () => {
  console.log("Proxy server started http://127.0.0.1:3000");
});
