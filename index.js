const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const app = express();
const NodeCache = require("node-cache");
const imageCache = new NodeCache({ stdTTL: 3600 }); // 1 hour

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get("/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).send("URL параметр обязателен");
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
    res.status(500).send("Ошибка при получении изображения");
  }
});

app.listen(3000, () => {
  console.log("Proxy server started http://localhost:3000");
});
