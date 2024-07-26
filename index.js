const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

app.get("/proxy-image", async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send("URL is required");
  }

  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const body = Buffer.from(response.data, "binary");
    const contentType = response.headers["content-type"];
    const originalSize = Buffer.byteLength(body);

    if (originalSize <= 2 * 1024 * 1024) {
      res.set("Content-Type", contentType);
      return res.send(body);
    }

    sharp(body)
      .toFormat("jpeg")
      .jpeg({ quality: 80 })
      .toBuffer()
      .then((compressedBuffer) => {
        const compressedSize = Buffer.byteLength(compressedBuffer);
        if (compressedSize > 2 * 1024 * 1024) {
          return sharp(body).jpeg({ quality: 60 }).toBuffer();
        }
        return compressedBuffer;
      })
      .then((finalBuffer) => {
        res.set("Content-Type", "image/jpeg");
        res.send(finalBuffer);
      })
      .catch((compressionError) => {
        res.status(500).send("Compressing error");
      });
  } catch (err) {
    res.status(500).send("Fetching error");
  }
});

app.listen(3000, () => {
  console.log("Proxy server started http://localhost:3000");
});
