const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let mqttLib = null;
try {
  mqttLib = require("mqtt");
} catch {
  mqttLib = null;
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 8877;
const PUBLIC_DIR = path.join(__dirname, "public");
const STORE_PATH = path.join(__dirname, "data", "store.json");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map();
const mqttRuntime = {
  client: null,
  status: "disabled",
  error: "",
};

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}_${Date.now().toString(36)}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = hashPassword(password, salt).hash;
  const left = Buffer.from(check, "hex");
  const right = Buffer.from(String(hash || ""), "hex");

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function sanitizeStore(parsed) {
  const data = parsed && typeof parsed === "object" ? parsed : {};
  const users = Array.isArray(data.users) ? data.users : [];

  return {
    settings: {
      name: data.settings?.name || "My Home",
      updatedAt: data.settings?.updatedAt || "",
    },
    mqtt: {
      enabled: Boolean(data.mqtt?.enabled),
      brokerUrl: String(data.mqtt?.brokerUrl || ""),
      username: String(data.mqtt?.username || ""),
      password: String(data.mqtt?.password || ""),
      baseTopic: String(data.mqtt?.baseTopic || "home/command-center"),
      qos: [0, 1, 2].includes(Number(data.mqtt?.qos)) ? Number(data.mqtt.qos) : 0,
      retain: Boolean(data.mqtt?.retain),
    },
    users: users.map((user) => ({
      id: String(user.id || randomId("user")),
      username: String(user.username || "").trim().toLowerCase(),
      displayName: String(user.displayName || user.username || "User").trim(),
      role: ["admin", "member", "viewer"].includes(String(user.role)) ? String(user.role) : "viewer",
      passwordSalt: String(user.passwordSalt || ""),
      passwordHash: String(user.passwordHash || ""),
      createdAt: String(user.createdAt || nowIso()),
    })).filter((user) => user.username),
    devices: Array.isArray(data.devices) ? data.devices : [],
    scenes: Array.isArray(data.scenes) ? data.scenes : [],
    activity: Array.isArray(data.activity) ? data.activity : [],
  };
}

function bootstrapDefaultAdmin(state) {
  if (state.users.length > 0) {
    return;
  }

  const creds = hashPassword("admin123");
  state.users.push({
    id: randomId("user"),
    username: "admin",
    displayName: "Administrator",
    role: "admin",
    passwordSalt: creds.salt,
    passwordHash: creds.hash,
    createdAt: nowIso(),
  });
  addActivity(state, "auth", "Default-Admin erstellt (admin / admin123)");
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    const state = sanitizeStore({});
    bootstrapDefaultAdmin(state);
    fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), "utf8");
  }
}

function readStore() {
  ensureStore();
  const text = fs.readFileSync(STORE_PATH, "utf8");
  const parsed = JSON.parse(text);
  const state = sanitizeStore(parsed);

  bootstrapDefaultAdmin(state);
  return state;
}

function writeStore(next) {
  const payload = {
    ...sanitizeStore(next),
    settings: {
      ...next.settings,
      updatedAt: nowIso(),
    },
  };

  fs.writeFileSync(STORE_PATH, JSON.stringify(payload, null, 2), "utf8");
}

function addActivity(state, type, detail) {
  state.activity = [
    {
      id: randomId("act"),
      type,
      detail,
      at: nowIso(),
    },
    ...(state.activity || []),
  ].slice(0, 250);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function safeMethod(method) {
  const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const normalized = String(method || "POST").toUpperCase();

  return allowed.includes(normalized) ? normalized : "POST";
}

function cleanPath(value) {
  const text = String(value || "/").trim();
  if (!text) {
    return "/";
  }

  return text.startsWith("/") ? text : `/${text}`;
}

function normalizeAction(action) {
  const mode = action.mode === "mqtt" ? "mqtt" : "http";

  return {
    id: action.id || randomId("action"),
    name: String(action.name || "Neue Aktion").trim() || "Neue Aktion",
    mode,
    method: safeMethod(action.method),
    path: cleanPath(action.path),
    topic: String(action.topic || "").trim(),
    body: typeof action.body === "string" ? action.body : JSON.stringify(action.body || {}),
    headers: typeof action.headers === "object" && action.headers !== null ? action.headers : {},
  };
}

function normalizeDevice(device) {
  const actions = Array.isArray(device.actions) ? device.actions.map(normalizeAction) : [];

  return {
    id: device.id || randomId("dev"),
    name: String(device.name || "Neues Geraet").trim() || "Neues Geraet",
    room: String(device.room || "Allgemein").trim() || "Allgemein",
    type: String(device.type || "custom").trim() || "custom",
    baseUrl: String(device.baseUrl || "").trim(),
    token: String(device.token || "").trim(),
    onlineHint: String(device.onlineHint || "").trim(),
    actions,
  };
}

function normalizeScene(scene) {
  return {
    id: scene.id || randomId("scene"),
    name: String(scene.name || "Neue Szene").trim() || "Neue Szene",
    steps: Array.isArray(scene.steps)
      ? scene.steps
          .map((step) => ({
            deviceId: String(step.deviceId || "").trim(),
            actionId: String(step.actionId || "").trim(),
          }))
          .filter((step) => step.deviceId && step.actionId)
      : [],
  };
}

function toSafeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
  };
}

function toSafeState(state, role = "viewer") {
  const allowTokens = role === "admin";

  return {
    settings: state.settings,
    mqtt: {
      ...state.mqtt,
      password: role === "admin" ? state.mqtt.password : "",
    },
    users: role === "admin" ? state.users.map(toSafeUser) : [],
    devices: state.devices.map((device) => ({
      ...device,
      token: allowTokens ? device.token : "",
    })),
    scenes: state.scenes,
    activity: state.activity,
  };
}

function parseAuthToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const headerToken = String(req.headers["x-auth-token"] || "").trim();
  return headerToken;
}

function cleanupSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

function getSession(req, state) {
  cleanupSessions();
  const token = parseAuthToken(req);
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  if (!session) {
    return null;
  }

  const user = state.users.find((entry) => entry.id === session.userId);
  if (!user) {
    sessions.delete(token);
    return null;
  }

  return {
    token,
    user,
    role: user.role,
    username: user.username,
  };
}

function hasRole(session, required) {
  const order = { viewer: 1, member: 2, admin: 3 };
  const left = order[session?.role || "viewer"] || 0;
  const right = order[required] || 99;

  return left >= right;
}

function authError(res) {
  sendJson(res, 401, { ok: false, message: "Nicht eingeloggt." });
}

function roleError(res, role) {
  sendJson(res, 403, { ok: false, message: `Mindestens Rolle ${role} erforderlich.` });
}

function ensureRole(res, session, required) {
  if (!session) {
    authError(res);
    return false;
  }

  if (!hasRole(session, required)) {
    roleError(res, required);
    return false;
  }

  return true;
}

function mqttConnect(config) {
  if (!mqttLib) {
    mqttRuntime.status = "unavailable";
    mqttRuntime.error = "mqtt Modul nicht installiert. npm install ausfuehren.";
    return;
  }

  if (!config.enabled || !config.brokerUrl) {
    if (mqttRuntime.client) {
      mqttRuntime.client.end(true);
      mqttRuntime.client = null;
    }
    mqttRuntime.status = "disabled";
    mqttRuntime.error = "";
    return;
  }

  if (mqttRuntime.client) {
    mqttRuntime.client.end(true);
    mqttRuntime.client = null;
  }

  mqttRuntime.status = "connecting";
  mqttRuntime.error = "";

  const options = {
    username: config.username || undefined,
    password: config.password || undefined,
    reconnectPeriod: 5000,
  };

  const client = mqttLib.connect(config.brokerUrl, options);
  mqttRuntime.client = client;

  client.on("connect", () => {
    mqttRuntime.status = "connected";
    mqttRuntime.error = "";
  });

  client.on("reconnect", () => {
    mqttRuntime.status = "reconnecting";
  });

  client.on("error", (err) => {
    mqttRuntime.status = "error";
    mqttRuntime.error = String(err.message || err);
  });

  client.on("close", () => {
    if (mqttRuntime.status !== "disabled") {
      mqttRuntime.status = "closed";
    }
  });
}

function mqttPublish(state, topic, payload, qos, retain) {
  return new Promise((resolve) => {
    if (!mqttLib) {
      resolve({ ok: false, message: "mqtt Modul nicht installiert." });
      return;
    }

    if (!mqttRuntime.client || mqttRuntime.status !== "connected") {
      resolve({ ok: false, message: "MQTT nicht verbunden." });
      return;
    }

    const cfg = state.mqtt;
    const safeTopic = String(topic || "").trim();
    if (!safeTopic) {
      resolve({ ok: false, message: "Topic fehlt." });
      return;
    }

    const mergedQos = [0, 1, 2].includes(Number(qos)) ? Number(qos) : cfg.qos;
    const mergedRetain = typeof retain === "boolean" ? retain : cfg.retain;

    mqttRuntime.client.publish(safeTopic, String(payload || ""), { qos: mergedQos, retain: mergedRetain }, (error) => {
      if (error) {
        resolve({ ok: false, message: String(error.message || error) });
        return;
      }

      resolve({ ok: true, topic: safeTopic, qos: mergedQos, retain: mergedRetain });
    });
  });
}

async function runAction(state, device, action) {
  if (action.mode === "mqtt") {
    const base = state.mqtt.baseTopic || "home/command-center";
    const topic = action.topic || `${base}/device/${device.id}/action/${action.id}`;
    return mqttPublish(state, topic, action.body || "{}", state.mqtt.qos, state.mqtt.retain);
  }

  if (!device.baseUrl) {
    return { ok: false, status: 0, message: "Device has no baseUrl" };
  }

  const url = `${device.baseUrl.replace(/\/$/, "")}${cleanPath(action.path)}`;
  const headers = {
    "Content-Type": "application/json",
    ...(action.headers || {}),
  };

  if (device.token) {
    headers.Authorization = `Bearer ${device.token}`;
  }

  let body;
  if (action.body && ["POST", "PUT", "PATCH", "DELETE"].includes(action.method)) {
    body = action.body;
  }

  try {
    const response = await fetch(url, {
      method: action.method,
      headers,
      body,
    });

    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      message: text.slice(0, 500),
      url,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: String(error.message || error),
      url,
    };
  }
}

function routeStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.normalize(filePath).replace(/^([.][.][/\\])+/, "");
  const absPath = path.join(PUBLIC_DIR, filePath);

  if (!absPath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
    sendText(res, 404, "Not Found");
    return;
  }

  const ext = path.extname(absPath).toLowerCase();
  const typeMap = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  };

  sendText(res, 200, fs.readFileSync(absPath), typeMap[ext] || "application/octet-stream");
}

async function routeApi(req, res, pathname) {
  const state = readStore();
  const session = getSession(req, state);

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = state.users.find((entry) => entry.username === username);

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      sendJson(res, 401, { ok: false, message: "Login fehlgeschlagen." });
      return;
    }

    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    addActivity(state, "auth", `Login: ${user.username}`);
    writeStore(state);

    sendJson(res, 200, { ok: true, token, user: toSafeUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/logout") {
    if (!session) {
      authError(res);
      return;
    }

    sessions.delete(session.token);
    addActivity(state, "auth", `Logout: ${session.username}`);
    writeStore(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/me") {
    if (!session) {
      authError(res);
      return;
    }

    sendJson(res, 200, { ok: true, user: toSafeUser(session.user) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    if (!ensureRole(res, session, "viewer")) {
      return;
    }

    sendJson(res, 200, toSafeState(state, session.role));
    return;
  }

  if (req.method === "GET" && pathname === "/api/users") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    sendJson(res, 200, { ok: true, users: state.users.map(toSafeUser) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/users") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const body = await parseBody(req);
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = ["admin", "member", "viewer"].includes(String(body.role)) ? String(body.role) : "viewer";
    const displayName = String(body.displayName || username || "User").trim();

    if (!username || password.length < 6) {
      sendJson(res, 400, { ok: false, message: "Username und Passwort (mind. 6 Zeichen) erforderlich." });
      return;
    }

    if (state.users.some((entry) => entry.username === username)) {
      sendJson(res, 409, { ok: false, message: "Username bereits vorhanden." });
      return;
    }

    const creds = hashPassword(password);
    const user = {
      id: randomId("user"),
      username,
      displayName,
      role,
      passwordSalt: creds.salt,
      passwordHash: creds.hash,
      createdAt: nowIso(),
    };
    state.users.push(user);
    addActivity(state, "auth", `User erstellt: ${username} (${role})`);
    writeStore(state);

    sendJson(res, 201, { ok: true, user: toSafeUser(user) });
    return;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/users/") && pathname.endsWith("/password")) {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const userId = pathname.split("/")[3] || "";
    const body = await parseBody(req);
    const password = String(body.password || "");

    if (password.length < 6) {
      sendJson(res, 400, { ok: false, message: "Passwort muss mindestens 6 Zeichen haben." });
      return;
    }

    const user = state.users.find((entry) => entry.id === userId);
    if (!user) {
      sendJson(res, 404, { ok: false, message: "User nicht gefunden." });
      return;
    }

    const creds = hashPassword(password);
    user.passwordSalt = creds.salt;
    user.passwordHash = creds.hash;
    addActivity(state, "auth", `Passwort geaendert: ${user.username}`);
    writeStore(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/mqtt/status") {
    if (!ensureRole(res, session, "viewer")) {
      return;
    }

    sendJson(res, 200, {
      ok: true,
      status: mqttRuntime.status,
      error: mqttRuntime.error,
      available: Boolean(mqttLib),
    });
    return;
  }

  if (req.method === "PUT" && pathname === "/api/mqtt/config") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const body = await parseBody(req);
    state.mqtt = {
      enabled: Boolean(body.enabled),
      brokerUrl: String(body.brokerUrl || ""),
      username: String(body.username || ""),
      password: String(body.password || ""),
      baseTopic: String(body.baseTopic || "home/command-center"),
      qos: [0, 1, 2].includes(Number(body.qos)) ? Number(body.qos) : 0,
      retain: Boolean(body.retain),
    };
    mqttConnect(state.mqtt);
    addActivity(state, "mqtt", `MQTT Konfiguration gespeichert (${state.mqtt.enabled ? "aktiv" : "inaktiv"})`);
    writeStore(state);
    sendJson(res, 200, { ok: true, mqtt: state.mqtt });
    return;
  }

  if (req.method === "POST" && pathname === "/api/mqtt/publish") {
    if (!ensureRole(res, session, "member")) {
      return;
    }

    const body = await parseBody(req);
    const result = await mqttPublish(
      state,
      body.topic,
      typeof body.payload === "string" ? body.payload : JSON.stringify(body.payload || {}),
      body.qos,
      body.retain
    );

    addActivity(state, "mqtt", `Publish: ${body.topic || "(ohne topic)"} => ${result.ok ? "OK" : "FAIL"}`);
    writeStore(state);
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, result });
    return;
  }

  if (req.method === "POST" && pathname === "/api/device/quickadd") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const body = await parseBody(req);
    const ip = String(body.ip || "").trim();
    const port = Math.min(65535, Math.max(1, Number(body.port) || 5000));
    const token = String(body.token || "").trim();
    const name = String(body.name || "").trim() || ("Geraet @ " + ip);
    const room = String(body.room || "Allgemein").trim();

    if (!ip || !/^[a-zA-Z0-9._-]+$/.test(ip)) {
      sendJson(res, 400, { ok: false, message: "Ungueltige IP oder Hostname." });
      return;
    }

    const baseUrl = "http://" + ip + ":" + port;
    let detected = "unknown";
    let online = false;

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 3000);
      const probeHeaders = {};
      if (token) probeHeaders.Authorization = "Bearer " + token;
      const probe = await fetch(baseUrl + "/health", { headers: probeHeaders, signal: controller.signal });
      clearTimeout(tid);
      if (probe.ok) { online = true; detected = "windows-agent"; }
    } catch {}

    const quickActions = [
      { name: "Status pruefen", mode: "http", method: "GET", path: "/health", body: "", headers: {} },
      { name: "Spotify starten", mode: "http", method: "POST", path: "/program/start", body: '{"name":"Spotify"}', headers: {} },
      { name: "Teams starten", mode: "http", method: "POST", path: "/program/start", body: '{"name":"Teams"}', headers: {} },
      { name: "Notepad starten", mode: "http", method: "POST", path: "/program/start", body: '{"name":"notepad.exe"}', headers: {} },
      { name: "Monitor aus", mode: "http", method: "POST", path: "/monitor/off", body: "{}", headers: {} },
    ];

    const device = normalizeDevice({ name, room, type: "pc", baseUrl, token, actions: quickActions });
    state.devices.unshift(device);
    addActivity(state, "device", "Quick-Add: " + name + " (" + baseUrl + ") " + (online ? "online" : "offline/unbekannt"));
    writeStore(state);

    sendJson(res, 201, { ok: true, device, detected, online });
    return;
  }

  if (req.method === "POST" && pathname === "/api/device") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const body = await parseBody(req);
    const device = normalizeDevice(body);
    state.devices.unshift(device);
    addActivity(state, "device", `Geraet erstellt: ${device.name}`);
    writeStore(state);
    sendJson(res, 201, { ok: true, device });
    return;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/device/")) {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const deviceId = pathname.split("/")[3] || "";
    const body = await parseBody(req);
    const next = normalizeDevice({ ...body, id: deviceId });
    const idx = state.devices.findIndex((d) => d.id === deviceId);

    if (idx === -1) {
      sendJson(res, 404, { ok: false, message: "Device not found" });
      return;
    }

    state.devices[idx] = next;
    addActivity(state, "device", `Geraet aktualisiert: ${next.name}`);
    writeStore(state);
    sendJson(res, 200, { ok: true, device: next });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/device/")) {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const deviceId = pathname.split("/")[3] || "";
    const before = state.devices.length;
    state.devices = state.devices.filter((d) => d.id !== deviceId);

    if (state.devices.length === before) {
      sendJson(res, 404, { ok: false, message: "Device not found" });
      return;
    }

    for (const scene of state.scenes) {
      scene.steps = scene.steps.filter((step) => step.deviceId !== deviceId);
    }

    addActivity(state, "device", `Geraet entfernt: ${deviceId}`);
    writeStore(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/device/") && pathname.endsWith("/action")) {
    if (!ensureRole(res, session, "member")) {
      return;
    }

    const parts = pathname.split("/");
    const deviceId = parts[3] || "";
    const body = await parseBody(req);
    const actionId = String(body.actionId || "").trim();

    const device = state.devices.find((d) => d.id === deviceId);
    if (!device) {
      sendJson(res, 404, { ok: false, message: "Device not found" });
      return;
    }

    const action = (device.actions || []).find((a) => a.id === actionId);
    if (!action) {
      sendJson(res, 404, { ok: false, message: "Action not found" });
      return;
    }

    const result = await runAction(state, device, action);
    addActivity(state, "run", `${device.name}: ${action.name} => ${result.ok ? "OK" : "FAIL"}`);
    writeStore(state);
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, result });
    return;
  }

  if (req.method === "POST" && pathname === "/api/scene") {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const body = await parseBody(req);
    const scene = normalizeScene(body);
    state.scenes.unshift(scene);
    addActivity(state, "scene", `Szene erstellt: ${scene.name}`);
    writeStore(state);
    sendJson(res, 201, { ok: true, scene });
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/api/scene/")) {
    if (!ensureRole(res, session, "admin")) {
      return;
    }

    const sceneId = pathname.split("/")[3] || "";
    const before = state.scenes.length;
    state.scenes = state.scenes.filter((s) => s.id !== sceneId);

    if (state.scenes.length === before) {
      sendJson(res, 404, { ok: false, message: "Scene not found" });
      return;
    }

    addActivity(state, "scene", `Szene entfernt: ${sceneId}`);
    writeStore(state);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/scene/") && pathname.endsWith("/run")) {
    if (!ensureRole(res, session, "member")) {
      return;
    }

    const sceneId = pathname.split("/")[3] || "";
    const scene = state.scenes.find((s) => s.id === sceneId);

    if (!scene) {
      sendJson(res, 404, { ok: false, message: "Scene not found" });
      return;
    }

    const results = [];
    for (const step of scene.steps) {
      const device = state.devices.find((d) => d.id === step.deviceId);
      const action = device?.actions?.find((a) => a.id === step.actionId);

      if (!device || !action) {
        results.push({ ok: false, message: "Missing device/action", step });
        continue;
      }

      const result = await runAction(state, device, action);
      results.push({ step, device: device.name, action: action.name, ...result });
    }

    const allOk = results.every((entry) => entry.ok);
    addActivity(state, "scene", `Szene ausgefuehrt: ${scene.name} (${allOk ? "OK" : "TEILFEHLER"})`);
    writeStore(state);
    sendJson(res, allOk ? 200 : 207, { ok: allOk, results });
    return;
  }

  sendJson(res, 404, { ok: false, message: "API route not found" });
}

function initMqttFromStore() {
  const state = readStore();
  mqttConnect(state.mqtt);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url.pathname);
      return;
    }

    routeStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: String(error.message || error) });
  }
});

initMqttFromStore();
server.listen(PORT, () => {
  console.log(`Home Command Center running on http://localhost:${PORT}`);
  if (!mqttLib) {
    console.log("MQTT optional: install with npm install");
  }
});
