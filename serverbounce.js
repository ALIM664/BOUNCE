const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

/* =====================================================
   НАСТРОЙКИ
===================================================== */

const PORT = process.env.PORT || 3000;
const MIN_LEVEL = 1;
const MAX_LEVEL = 5;
const MAX_VELOCITY = 100;

const LEVEL_NAMES = {
    1: "Tendo",
    2: "Infiltration",
    3: "Freaks",
    4: "The Ghost",
    5: "Into Pieces"
};

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: true,
        credentials: true
    }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   СОСТОЯНИЕ ИГРОКОВ
===================================================== */

const players = Object.create(null);
const collisionCooldowns = new Map();

function isValidLevel(value) {
    const level = Number(value);

    return (
        Number.isInteger(level) &&
        level >= MIN_LEVEL &&
        level <= MAX_LEVEL
    );
}

function normalizeLevel(value) {
    const level = Number(value);

    return isValidLevel(level)
        ? level
        : MIN_LEVEL;
}

function levelRoom(level) {
    return `level:${normalizeLevel(level)}`;
}

function levelName(level) {
    return LEVEL_NAMES[normalizeLevel(level)] ||
        `Level ${normalizeLevel(level)}`;
}

function clampVelocity(value) {
    const number = Number(value);

    if (!Number.isFinite(number))
        return 0;

    return Math.max(
        -MAX_VELOCITY,
        Math.min(MAX_VELOCITY, number)
    );
}

/* =====================================================
   СПИСОК ИГРОКОВ ОДНОГО УРОВНЯ
===================================================== */

function snapshotForLevel(level) {
    const result = Object.create(null);

    for (const [id, player] of Object.entries(players)) {
        if (
            player.inGame &&
            player.level === level
        ) {
            result[id] = { ...player };
        }
    }

    return result;
}

function broadcastLevel(level) {
    if (!isValidLevel(level))
        return;

    io.to(levelRoom(level)).emit(
        "players:update",
        snapshotForLevel(Number(level))
    );
}

/* =====================================================
   СИСТЕМНЫЕ СООБЩЕНИЯ
===================================================== */

function systemMessage(message) {
    io.emit("chat:message", {
        type: "system",
        username: "сервер",
        message: String(message).slice(0, 250),
        time: Date.now()
    });

    console.log(`[SYSTEM] ${message}`);
}

function announceJoin(player) {
    const nickname = String(
        player.nickname || "Игрок"
    ).trim().slice(0, 20);

    systemMessage(
        `игрок "${nickname}" присоединился к игре (${levelName(player.level)})`
    );
}

function announceLeave(player, level = player.level) {
    const nickname = String(
        player.nickname || "Игрок"
    ).trim().slice(0, 20);

    systemMessage(
        `игрок "${nickname}" вышел из игры (${levelName(level)})`
    );
}

/* =====================================================
   ПРОВЕРКА И СОХРАНЕНИЕ ПИКСЕЛЕЙ
===================================================== */

function sanitizePixels(pixels) {
    if (
        !Array.isArray(pixels) ||
        pixels.length !== 8
    ) {
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

            if (
                !pixel ||
                typeof pixel !== "object"
            ) {
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
                pixel.a == null
                    ? 1
                    : Number(pixel.a);

            const a =
                Number.isFinite(alphaValue)
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
   ВЫХОД ИЗ УРОВНЯ
===================================================== */

function leavePlayerLevel(socket) {
    const player = players[socket.id];

    if (!player || !player.inGame)
        return;

    const oldLevel = player.level;

    player.inGame = false;

    socket.leave(levelRoom(oldLevel));

    // Обновляем список игроков старого уровня.
    broadcastLevel(oldLevel);

    // Очищаем список игроков у самого вышедшего.
    socket.emit("players:update", {});

    // Сообщение о выходе.
    announceLeave(player, oldLevel);
}

/* =====================================================
   ВХОД В УРОВЕНЬ
===================================================== */

function enterPlayerLevel(socket, levelValue) {
    const player = players[socket.id];

    if (
        !player ||
        !isValidLevel(levelValue)
    ) {
        return;
    }

    const newLevel = Number(levelValue);

    // Если игрок уже находится на этой карте,
    // повторно сообщение не отправляем.
    if (
        player.inGame &&
        player.level === newLevel
    ) {
        socket.join(levelRoom(newLevel));

        socket.emit(
            "players:update",
            snapshotForLevel(newLevel)
        );

        return;
    }

    // Если игрок был на другой карте,
    // сначала отправляем сообщение о выходе.
    if (player.inGame) {
        leavePlayerLevel(socket);
    }

    player.level = newLevel;
    player.inGame = true;

    socket.join(levelRoom(newLevel));

    // Отправляем игроку список новой карты.
    socket.emit(
        "players:update",
        snapshotForLevel(newLevel)
    );

    // Обновляем список игроков этой карты.
    broadcastLevel(newLevel);

    // Отправляем сообщение о входе.
    announceJoin(player);
}

/* =====================================================
   СМЕНА ВЫБРАННОЙ КАРТЫ
===================================================== */

function movePlayerToLevel(socket, levelValue) {
    const player = players[socket.id];

    if (
        !player ||
        !isValidLevel(levelValue)
    ) {
        return;
    }

    const newLevel = Number(levelValue);

    if (player.inGame) {
        enterPlayerLevel(socket, newLevel);
    } else {
        // В меню только запоминаем выбранный уровень.
        // Сообщение о входе пока не отправляем.
        player.level = newLevel;
    }
}

/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {
    const initialLevel = MIN_LEVEL;

    players[socket.id] = {
        id: socket.id,

        level: initialLevel,
        inGame: false,

        x: 200,
        y: 250,

        vx: 0,
        vy: 0,

        size: 64,

        nickname: "Игрок",
        pixels: null,

        lastMoveAt: Date.now(),
        lastChatAt: 0,
        lastDeathNoticeAt: 0
    };

    // Простое подключение к сайту
    // не считается входом в уровень.
    socket.emit("players:update", {});

    console.log(
        `Игрок подключился: ${socket.id}`
    );

    /* =================================================
       ИМЯ ИГРОКА
    ================================================= */

    socket.on("player:name", name => {
        const player = players[socket.id];

        if (
            !player ||
            typeof name !== "string"
        ) {
            return;
        }

        const cleanName =
            name.trim().slice(0, 20) || "Игрок";

        player.nickname = cleanName;

        if (player.inGame) {
            broadcastLevel(player.level);
        }
    });

    /* =================================================
       ВЫБОР УРОВНЯ
    ================================================= */

    socket.on("player:level", level => {
        if (!isValidLevel(level))
            return;

        movePlayerToLevel(
            socket,
            Number(level)
        );
    });

    /* =================================================
       ФАКТИЧЕСКИЙ ВХОД В УРОВЕНЬ
       КНОПКА START
    ================================================= */

    socket.on("player:enter-level", data => {
        const player = players[socket.id];

        if (!player)
            return;

        const level =
            data && typeof data === "object"
                ? data.level
                : data;

        if (!isValidLevel(level))
            return;

        if (
            data &&
            typeof data === "object" &&
            typeof data.nickname === "string"
        ) {
            player.nickname =
                data.nickname.trim().slice(0, 20) ||
                "Игрок";
        }

        enterPlayerLevel(
            socket,
            Number(level)
        );
    });

    /* =================================================
       ФАКТИЧЕСКИЙ ВЫХОД ИЗ УРОВНЯ
       КНОПКА MENU
    ================================================= */

    socket.on("player:leave-level", () => {
        leavePlayerLevel(socket);
    });

    /* =================================================
       ПОЗИЦИЯ, СКОРОСТЬ И РИСУНОК КУБА
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

        // Обновляем выбранный уровень,
        // но не вводим игрока в игру.
        if (
            data.level != null &&
            isValidLevel(data.level) &&
            Number(data.level) !== player.level
        ) {
            movePlayerToLevel(
                socket,
                Number(data.level)
            );
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

        if (typeof data.nickname === "string") {
            player.nickname =
                data.nickname.trim().slice(0, 20) ||
                "Игрок";
        }

        const cleanPixels =
            sanitizePixels(data.pixels);

        if (cleanPixels) {
            player.pixels = cleanPixels;
        }

        const size = Number(data.size);

        if (Number.isFinite(size)) {
            player.size = Math.max(
                16,
                Math.min(256, size)
            );
        }

        // Передаём обновления только игрокам этой карты.
        if (player.inGame) {
            broadcastLevel(player.level);
        }
    });

    /* =================================================
       СТОЛКНОВЕНИЕ ДВУХ ИГРОКОВ
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

        // Коллизии разрешены только на одной карте.
        if (
            !self ||
            !target ||
            !self.inGame ||
            !target.inGame ||
            self.level !== target.level
        ) {
            return;
        }

        const now = Date.now();

        const pairKey = [
            socket.id,
            targetId
        ].sort().join("|");

        const lastCollision =
            collisionCooldowns.get(pairKey) || 0;

        if (now - lastCollision < 100)
            return;

        collisionCooldowns.set(
            pairKey,
            now
        );

        self.vx = clampVelocity(data.selfVx);
        self.vy = clampVelocity(data.selfVy);

        target.vx = clampVelocity(data.targetVx);
        target.vy = clampVelocity(data.targetVy);

        io.to(socket.id).emit(
            "player:bounce",
            {
                vx: self.vx,
                vy: self.vy
            }
        );

        io.to(targetId).emit(
            "player:bounce",
            {
                vx: target.vx,
                vy: target.vy
            }
        );

        broadcastLevel(self.level);

        // Чистим старые записи защиты от повторных столкновений.
        for (const [key, timestamp] of collisionCooldowns) {
            if (now - timestamp > 10000) {
                collisionCooldowns.delete(key);
            }
        }
    });

    /* =================================================
       ОБЫЧНЫЙ ЧАТ
       ОБЩИЙ ДЛЯ ВСЕХ КАРТ
    ================================================= */

    socket.on("chat:message", message => {
        const player = players[socket.id];

        if (
            !player ||
            typeof message !== "string"
        ) {
            return;
        }

        const cleanMessage =
            message.trim().slice(0, 200);

        if (!cleanMessage)
            return;

        const now = Date.now();

        // Небольшая защита от спама.
        if (now - player.lastChatAt < 400)
            return;

        player.lastChatAt = now;

        io.emit("chat:message", {
            type: "chat",
            username: player.nickname || "Игрок",
            message: cleanMessage,
            time: now
        });
    });

    /* =================================================
       СИСТЕМНЫЕ СООБЩЕНИЯ О СМЕРТИ
    ================================================= */

    socket.on("player:died", data => {
        const player = players[socket.id];

        if (
            !player ||
            !player.inGame ||
            !data ||
            typeof data !== "object"
        ) {
            return;
        }

        const reason = data.reason;

        if (
            reason !== "fall" &&
            reason !== "spikes"
        ) {
            return;
        }

        const now = Date.now();

        if (now - player.lastDeathNoticeAt < 1000)
            return;

        player.lastDeathNoticeAt = now;

        const nickname = String(
            player.nickname || "Игрок"
        ).trim().slice(0, 20);

        if (reason === "fall") {
            systemMessage(
                `игрок "${nickname}" вылетел за карту`
            );
        } else {
            systemMessage(
                `игрок "${nickname}" влетел в шипы`
            );
        }
    });

    /* =================================================
       ОТКЛЮЧЕНИЕ ИГРОКА
    ================================================= */

    socket.on("disconnect", reason => {
        const player = players[socket.id];

        if (!player)
            return;

        const oldLevel = player.level;
        const wasInGame = player.inGame;

        delete players[socket.id];

        if (wasInGame) {
            announceLeave(
                player,
                oldLevel
            );

            broadcastLevel(oldLevel);
        }

        for (const [key, timestamp] of collisionCooldowns) {
            if (key.split("|").includes(socket.id)) {
                collisionCooldowns.delete(key);
            }
        }

        console.log(
            `Игрок отключился: ${socket.id} (${reason})`
        );
    });
});

/* =====================================================
   API ПОИСКА ИГРОКОВ
   ТОЛЬКО ИГРОКИ ВЫБРАННОЙ КАРТЫ
===================================================== */

app.get("/api/players", (req, res) => {
    const search = String(
        req.query.search || ""
    ).trim().toLocaleLowerCase();

    const level = normalizeLevel(
        req.query.level
    );

    const result = Object.values(players).filter(player => {
        // Ищем только игроков, выбравших эту карту.
        if (player.level !== level) return false;
    
        const nickname = String(
            player.nickname || "Игрок"
        ).toLocaleLowerCase();
        
        return !search || nickname.includes(search);
    });

    res.json(
        result.map(player => ({
            nickname: player.nickname || "Игрок",
            level: player.level,
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
   СТАТИЧЕСКИЕ ФАЙЛЫ И ГЛАВНАЯ СТРАНИЦА
===================================================== */

app.use(express.static(__dirname));

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

app.use((req, res, next) => {
    if (req.method !== "GET")
        return next();

    res.status(404).send(
        "Страница не найдена"
    );
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
