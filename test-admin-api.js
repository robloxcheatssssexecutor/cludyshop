require("dotenv").config();
const http = require("http");

function req(method, urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const boundary = "----TestBoundary" + Date.now();
    let payload;
    const headers = { Cookie: opts.cookie || "" };
    if (opts.multipart) {
      const fields = opts.fields || {
        name: "Test Product",
        price: "9.99",
        category: "tools",
        stock: "-1",
        showStock: "0",
        showPurchases: "1",
        offerActive: "0",
        offerPrice: "",
        offerLabel: "",
        description: "desc test",
      };
      let body = "";
      for (const [k, v] of Object.entries(fields)) {
        body += `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
      }
      body += `--${boundary}--\r\n`;
      payload = Buffer.from(body);
      headers["Content-Type"] = "multipart/form-data; boundary=" + boundary;
      headers["Content-Length"] = payload.length;
    } else if (opts.body) {
      payload = Buffer.from(JSON.stringify(opts.body));
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = payload.length;
    }
    const r = http.request({ hostname: "127.0.0.1", port: 3000, path: urlPath, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const login = await req("POST", "/api/admin/login", {
    body: { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASSWORD },
  });
  console.log("LOGIN", login.status, login.body);
  const cookie = (login.headers["set-cookie"] || [])[0]?.split(";")[0] || "";
  const post = await req("POST", "/api/admin/products", { cookie, multipart: true });
  console.log("POST PRODUCT", post.status, post.body);
  const products = JSON.parse((await req("GET", "/api/admin/products", { cookie })).body);
  const test = products.find((p) => p.name === "Test Product");
  console.log("Created product", test);
  if (test) {
    const put = await req("PUT", `/api/admin/products/${test.id}`, {
      cookie,
      multipart: true,
      fields: {
        name: "Test Product Updated",
        price: "12.50",
        category: "methods",
        stock: "5",
        showStock: "1",
        showPurchases: "1",
        offerActive: "0",
        offerPrice: "",
        offerLabel: "",
        description: "updated",
        active: "1",
      },
    });
    console.log("PUT PRODUCT", put.status, put.body);
    const afterPut = JSON.parse((await req("GET", "/api/admin/products", { cookie })).body).find((p) => p.id === test.id);
    console.log("After PUT", afterPut?.name, afterPut?.price);
    const del = await req("DELETE", `/api/admin/products/${test.id}`, { cookie });
    console.log("DELETE", del.status, del.body);
    const afterDel = JSON.parse((await req("GET", "/api/admin/products", { cookie })).body).find((p) => p.id === test.id);
    console.log("After DELETE active=", afterDel?.active, "exists=", !!afterDel);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
