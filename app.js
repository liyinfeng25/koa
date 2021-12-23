const fs = require("fs");
const path = require("path");
const Koa = require("koa");
const util = require("util");
const serve = require("koa-static");
const cors = require("@koa/cors");
const multer = require("@koa/multer");
const Router = require("@koa/router");
const fse = require("fs-extra");
const readdir = util.promisify(fs.readdir);
const unlink = util.promisify(fs.unlink);

const app = new Koa();
const router = new Router();
const PORT = 9002;
// 上传后资源的URL地址
const RESOURCE_URL = `http://localhost:${PORT}`;
// 存储上传文件的目录
const UPLOAD_DIR = path.join(__dirname, "/public/upload");
const TMP_DIR = path.join(__dirname, "tmp"); // 临时目录
const IGNORES = [".DS_Store"]; // 忽略的文件列表

console.log('UPLOAD_DIR', UPLOAD_DIR)

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    // 设置文件的存储目录
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    // 设置文件名
    cb(null, `${file.originalname}`);
  },
});

const multerUpload = multer({ storage });


// 文件分片上传
const storageSlice = multer.diskStorage({
  destination: async function (req, file, cb) {
    let fileMd5 = file.originalname.split("-")[0];
    console.log('文件分片上传 destination', fileMd5);
    const fileDir = path.join(TMP_DIR, fileMd5);
    await fse.ensureDir(fileDir);
    cb(null, fileDir);
  },
  filename: function (req, file, cb) {
    let chunkIndex = file.originalname.split("-")[1];
    console.log('文件分片上传 filename', chunkIndex);

    cb(null, `${chunkIndex}`);
  },
});

const multerUploadSlice = multer({ storage: storageSlice });

router.get("/", async (ctx) => {
  ctx.body = "欢迎使用文件服务（by 阿宝哥）";
});

// 单文件上传
router.post(
  "/upload/single",
  async (ctx, next) => {
    try {
      await next();
      ctx.body = {
        code: 0,
        msg: "文件上传成功",
        url: `${RESOURCE_URL}/${ctx.file.originalname}`,
      };
    } catch (error) {
      ctx.body = {
        code: 1001,
        msg: "文件上传失败"
      };
    }
  },
  multerUpload.single("file")
);

// 多文件上传
router.post(
  "/upload/multiple",
  async (ctx, next) => {
    try {
      await next();
      urls = ctx.files.file.map(file => `${RESOURCE_URL}/${file.originalname}`);
      ctx.body = {
        code: 0,
        msg: "文件上传成功",
        urls
      };
    } catch (error) {
      ctx.body = {
        code: 1001,
        msg: "文件上传失败",
      };
    }
  },
  multerUpload.fields([
    {
      name: "file", // 与FormData表单项的fieldName想对应
    },
  ])
);

// 检测文件是否上传
router.get("/upload/exists", async (ctx) => {
  const { name: fileName, md5: fileMd5 } = ctx.query;
  const filePath = path.join(UPLOAD_DIR, fileName);
  const isExists = await fse.pathExists(filePath);
  if (isExists) {
    ctx.body = {
      code: 0,
      status: "success",
      data: {
        isExists: true,
        url: `http://localhost:9002/${fileName}`,
      },
    };
  } else {
    let chunkIds = [];
    const chunksPath = path.join(TMP_DIR, fileMd5);
    const hasChunksPath = await fse.pathExists(chunksPath);
    if (hasChunksPath) {
      let files = await readdir(chunksPath);
      chunkIds = files.filter((file) => {
        return IGNORES.indexOf(file) === -1;
      });
    }
    ctx.body = {
      code: 0,
      status: "success",
      data: {
        isExists: false,
        chunkIds,
      },
    };
  }
});

// 文件分割上传
router.post(
  "/upload/single1",
  multerUploadSlice.single("file"),
  async (ctx, next) => {
    ctx.body = {
      code: 0,
      data: ctx.file,
    };
  }
);

router.get("/upload/concatFiles", async (ctx) => {
  const { name: fileName, md5: fileMd5 } = ctx.query;
  await concatFiles(
    path.join(TMP_DIR, fileMd5),
    path.join(UPLOAD_DIR, fileName)
  );
  ctx.body = {
    code:0,
    status: "success",
    data: {
      url: `http://localhost:9002/${fileName}`,
    },
  };
});

async function concatFiles(sourceDir, targetPath) {
  const readFile = (file, ws) =>
    new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .on("data", (data) => ws.write(data))
        .on("end", resolve)
        .on("error", reject);
    });
  const files = await readdir(sourceDir);
  const sortedFiles = files
    .filter((file) => {
      return IGNORES.indexOf(file) === -1;
    })
    .sort((a, b) => a - b);
  const writeStream = fs.createWriteStream(targetPath);
  for (const file of sortedFiles) {
    let filePath = path.join(sourceDir, file);
    await readFile(filePath, writeStream);
    // await unlink(filePath); // 删除已合并的分块
  }
  writeStream.end();
}



// 注册中间件
app.use(cors());
app.use(serve(UPLOAD_DIR));
app.use(router.routes()).use(router.allowedMethods());

app.listen(PORT, () => {
  console.log(`app starting at port ${PORT}`);
});
