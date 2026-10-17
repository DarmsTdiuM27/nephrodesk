/**
 * NephroDesk AI Pro — Full-Stack HTTP Server Entrypoint
 * Serves both the interactive bilingual WebApp (at '/' and '/nephrodesk-ai-pro.html')
 * and the REST API endpoints ('/api/v1/health', '/api/v1/calculators/*', '/api/v1/patients').
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createNephroDeskService } = require("./app");

const service = createNephroDeskService();
const PORT = process.env.PORT || 8080;
const WEBAPP_PATH = path.join(__dirname, "../../public/nephrodesk-ai-pro.html");

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Standard Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  const url = (req.url || "/").split("?")[0];

  // 1. Serve Interactive Bilingual WebApp at '/' or '/index.html' or '/nephrodesk-ai-pro.html'
  if (req.method === "GET" && (url === "/" || url === "/index.html" || url === "/nephrodesk-ai-pro.html")) {
    res.setHeader("Content-Security-Policy", "default-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none';");
    if (fs.existsSync(WEBAPP_PATH)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(WEBAPP_PATH).pipe(res);
      return;
    }
  }

  //Strict API CSP for all JSON endpoints
  res.setHeader("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none';");

  // 2. Health-Check Endpoint
  if (url === "/api/v1/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        product: "NephroDesk AI Pro",
        version: "1.0.0-rc.1",
        timestamp: new Date().toISOString()
      })
    );
    return;
  }

  // 3. Clinical Calculators REST Endpoint: POST /api/v1/calculators/:id
  if (url.startsWith("/api/v1/calculators/") && req.method === "POST") {
    const calcId = url.replace("/api/v1/calculators/", "");
    try {
      const body = await readJsonBody(req);
      let result;
      if (calcId === "ckd-epi-2021") result = service.calculators.calculateCkdEpi2021(body);
      else if (calcId === "fena") result = service.calculators.calculateFeNa(body);
      else if (calcId === "anion-gap") result = service.calculators.calculateAnionGap(body);
      else if (calcId === "urine-ratio") result = service.calculators.calculateUrineRatio(body);
      else if (calcId === "cockcroft-gault") result = service.calculators.calculateCockcroftGault(body);
      else if (calcId === "free-water-deficit") result = service.calculators.calculateFreeWaterDeficit(body);
      else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UNKNOWN_CALCULATOR" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CALCULATION_VALIDATION_ERROR", message: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "NOT_FOUND", message: "Endpoint not found. Consult openapi.yaml." }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`NephroDesk AI Pro Full-Stack Server listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { server, service };
