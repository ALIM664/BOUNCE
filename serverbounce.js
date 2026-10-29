const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

/* =====================================================
   НАСТРОЙКИ
===================================================== */

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   ИГРОКИ И СТОЛКНОВЕНИЯ
===================================================== */

const players = Object.create(null);
const collisionCooldowns = new Map();

const MAX_VELOCITY = 100;

function clampVelocity(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.max(
        -MAX_VELOCITY,
        Math.min(MAX_VELOCITY, number)
    );
}

/* =====================================================
   ПРОВЕРКА И СОХРАНЕНИЕ ПИКСЕЛЕЙ КУБА
===================================================== */

function sanitizePixels(pixels) {
    if (!Array.isArray(pixels) || pixels.length !== 8) {
        return null;
    }

    const result = [];

    for (let y = 0; y < 8; y++) {
        if (
            !Array.isArray(pixels[y]) ||
            pixels[y].length !== 8
        ) {
            return null;
        }

        result[y] = [];

        for (let x = 0; x < 8; x++) {
            const pixel = pixels[y][x];

            if (!pixel || typeof pixel !== "object") {
                result[y][x] = null;
                continue;
            }

            const channel = value => {
                const n = Number(value);

                return Number.isFinite(n)
                    ? Math.max(0, Math.min(255, n))
                    : 0;
            };

            const alphaValue =
                pixel.a == null ? 1 : Number(pixel.a);

            const a = Number.isFinite(alphaValue)
                ? Math.max(0, Math.min(1, alphaValue))
                : 1;

            result[y][x] = {
                r: channel(pixel.r),
                g: channel(pixel.g),
                b: channel(pixel.b),
                a
            };
        }
    }

    return result;
}

/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {
    console.log(`Игрок подключён: ${socket.id}`);

    players[socket.id] = {
        id: socket.id,

        x: 200,
        y: 250,

        // Скорость по горизонтали и вертикали.
        vx: 0,
        vy: 0,

        size: 64,
        nickname: "Игрок",
        pixels: null,

        lastMoveAt: Date.now()
    };

    // Отправляем актуальных игроков.
    socket.emit("players:update", players);
    io.emit("players:update", players);

    /* =================================================
       ИМЯ ИГРОКА
    ================================================= */

    socket.on("player:name", name => {
        if (typeof name !== "string") {
            return;
        }

        const player = players[socket.id];

        if (!player) {
            return;
        }

        player.nickname =
            name.trim().slice(0, 20) || "Игрок";

        io.emit("players:update", players);
    });

    /* =================================================
       ПОЗИЦИЯ И СКОРОСТЬ ИГРОКА
    ================================================= */

    socket.on("player:move", data => {
        const player = players[socket.id];

        if (
            !player ||
            !data ||
            typeof data !== "object"
        ) {
            return;
        }

        const previousX = player.x;
        const previousY = player.y;

        const now = Date.now();

        const elapsedMs = Math.max(
            0,
            now - (player.lastMoveAt || now)
        );

        const elapsedFrames = Math.max(
            elapsedMs / (1000 / 60),
            1
        );

        const x = Number(data.x);
        const y = Number(data.y);

        // Обновляем координаты.
        if (
            Number.isFinite(x) &&
            Number.isFinite(y)
        ) {
            player.x = Math.max(
                -100000,
                Math.min(100000, x)
            );

            player.y = Math.max(
                -100000,
                Math.min(100000, y)
            );
        }

        // Если клиент передал скорость, используем её.
        // Иначе оцениваем скорость по изменению координат.
        const incomingVx = Number(data.vx);
        const incomingVy = Number(data.vy);

        if (Number.isFinite(incomingVx)) {
            player.vx = clampVelocity(incomingVx);
        } else if (
            Number.isFinite(x) &&
            elapsedMs > 0
        ) {
            player.vx = clampVelocity(
                (player.x - previousX) / elapsedFrames
            );
        }

        if (Number.isFinite(incomingVy)) {
            player.vy = clampVelocity(incomingVy);
        } else if (
            Number.isFinite(y) &&
            elapsedMs > 0
        ) {
            player.vy = clampVelocity(
                (player.y - previousY) / elapsedFrames
            );
        }

        player.lastMoveAt = now;

        // Обновляем ник.
        if (typeof data.nickname === "string") {
            player.nickname =
                data.nickname.trim().slice(0, 20) || "Игрок";
        }

        // Сохраняем пиксельный куб.
        const cleanPixels = sanitizePixels(data.pixels);

        if (cleanPixels) {
            player.pixels = cleanPixels;
        }

        // Обновляем размер куба.
        const size = Number(data.size);

        if (Number.isFinite(size)) {
            player.size = Math.max(
                16,
                Math.min(256, size)
            );
        }

        io.emit("players:update", players);
    });

    /* =================================================
       СИНХРОНИЗАЦИЯ ОТСКОКА
       ВАЖНО: обработчик находится внутри connection.
    ================================================= */

    socket.on("player:collision", data => {
        if (
            !data ||
            typeof data !== "object"
        ) {
            return;
        }

        const targetId = data.targetId;

        if (
            typeof targetId !== "string" ||
            targetId === socket.id
        ) {
            return;
        }

        const self = players[socket.id];
        const target = players[targetId];

        if (!self || !target) {
            return;
        }

        // Не допускаем слишком частые повторные события
        // одного и того же столкновения.
        const now = Date.now();

        const pairKey = [
            socket.id,
            targetId
        ].sort().join("|");

        const lastCollision =
            collisionCooldowns.get(pairKey) || 0;

        if (now - lastCollision < 100) {
            return;
        }

        collisionCooldowns.set(pairKey, now);

        // Принимаем рассчитанные клиентом скорости.
        self.vx = clampVelocity(data.selfVx);
        self.vy = clampVelocity(data.selfVy);

        target.vx = clampVelocity(data.targetVx);
        target.vy = clampVelocity(data.targetVy);

        // Отправляем скорость первому игроку.
        io.to(socket.id).emit("player:bounce", {
            vx: self.vx,
            vy: self.vy
        });

        // Отправляем скорость второму игроку.
        io.to(targetId).emit("player:bounce", {
            vx: target.vx,
            vy: target.vy
        });

        // Остальные клиенты также получают обновление.
        io.emit("players:update", players);

        // Очищаем старые записи.
        for (const [key, timestamp] of collisionCooldowns) {
            if (now - timestamp > 10000) {
                collisionCooldowns.delete(key);
            }
        }
    });

    /* =================================================
       CHAT
    ================================================= */

    socket.on("chat:message", message => {
        if (typeof message !== "string") {
            return;
        }

        const cleanMessage = message.trim().slice(0, 200);

        if (!cleanMessage) {
            return;
        }

        io.emit("chat:message", {
            username:
                players[socket.id]?.nickname || "Игрок",

            message: cleanMessage,
            time: Date.now()
        });
    });

    /* =================================================
       ОТКЛЮЧЕНИЕ ИГРОКА
    ================================================= */

    socket.on("disconnect", reason => {
        delete players[socket.id];

        // Удаляем таймеры столкновений с отключившимся игроком.
        for (const key of collisionCooldowns.keys()) {
            if (key.split("|").includes(socket.id)) {
                collisionCooldowns.delete(key);
            }
        }

        io.emit("player:left", socket.id);
        io.emit("players:update", players);

        console.log(
            `Игрок отключён: ${socket.id} (${reason})`
        );
    });
});

/* =====================================================
   API ИГРОКОВ — ПОИСК ПО НИКУ
===================================================== */

app.get("/api/players", (req, res) => {
    const search = String(req.query.search || "")
        .trim()
        .toLocaleLowerCase();

    const result = Object.values(players).filter(player => {
        const nickname = String(
            player.nickname || "Игрок"
        ).toLocaleLowerCase();

        return !search || nickname.includes(search);
    });

    // Не показываем ID в публичном API поиска.
    res.json(
        result.map(player => ({
            nickname: player.nickname || "Игрок",

            x: player.x,
            y: player.y,

            vx: player.vx,
            vy: player.vy,

            size: player.size,
            pixels: player.pixels
        }))
    );
});

/* =====================================================
   СТАТИЧЕСКИЕ ФАЙЛЫ
===================================================== */

app.use(express.static(__dirname));

/* =====================================================
   ГЛАВНАЯ СТРАНИЦА
===================================================== */

app.get("/", (req, res) => {
    const htmlPath = path.join(
        __dirname,
        "BOUNCE.html"
    );

    if (!fs.existsSync(htmlPath)) {
        return res.status(500).send(
            "Не найден файл BOUNCE.html рядом с сервером."
        );
    }

    res.sendFile(htmlPath);
});

/* =====================================================
   FALLBACK
===================================================== */

app.use((req, res, next) => {
    if (req.method !== "GET") {
        return next();
    }

    res.status(404).send("Страница не найдена");
});

/* =====================================================
   ЗАПУСК СЕРВЕРА
===================================================== */

server.on("error", error => {
    console.error(
        "Не удалось запустить сервер:",
        error.message
    );

    if (error.code === "EADDRINUSE") {
        console.error(
            `Порт ${PORT} уже занят.`
        );
    }
});

server.listen(PORT, () => {
    console.log("================================");
    console.log(" BOUNCE SERVER ЗАПУЩЕН");
    console.log(` PORT: ${PORT}`);
    console.log(" PLAYERS: ONLINE");
    console.log("================================");
});
