const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

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

app.use(
    express.json({
        limit: "2mb"
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);

/* =====================================================
   STATIC
===================================================== */

app.use(
    express.static(__dirname)
);

/* =====================================================
   ИГРОКИ
===================================================== */

const players = {};


/* =====================================================
   ОЧИСТКА PIXELS
===================================================== */

function sanitizePixels(pixels) {

    if (!Array.isArray(pixels))
        return null;

    if (pixels.length !== 8)
        return null;

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

            const pixel =
                pixels[y][x];

            if (
                !pixel ||
                typeof pixel !== "object"
            ) {
                result[y][x] = null;
                continue;
            }

            const r =
                Math.max(
                    0,
                    Math.min(
                        255,
                        Number(pixel.r) || 0
                    )
                );

            const g =
                Math.max(
                    0,
                    Math.min(
                        255,
                        Number(pixel.g) || 0
                    )
                );

            const b =
                Math.max(
                    0,
                    Math.min(
                        255,
                        Number(pixel.b) || 0
                    )
                );

            const a =
                pixel.a == null
                    ? 1
                    : Math.max(
                        0,
                        Math.min(
                            1,
                            Number(pixel.a)
                        )
                    );

            result[y][x] = {
                r,
                g,
                b,
                a
            };
        }
    }

    return result;
}


/* =====================================================
   КОЛЛИЗИИ ИГРОКОВ
===================================================== */

/*
   При столкновении:

   speed1 = скорость P1
   speed2 = скорость P2

   sharedSpeed =
       (speed1 + speed2) / 2

   После столкновения:

   P1 → sharedSpeed
   P2 → sharedSpeed

   но в противоположных направлениях.

   Работает и когда один игрок стоит:

   P1 = 100
   P2 = 0

   результат:

   P1 = 50
   P2 = 50
*/

/* =====================================================
   КОЛЛИЗИИ ИГРОКОВ
===================================================== */

function resolvePlayerCollisions() {

    const list =
        Object.values(players);

    for (let i = 0; i < list.length; i++) {

        for (let j = i + 1; j < list.length; j++) {

            const p1 = list[i];
            const p2 = list[j];

            if (!p1 || !p2)
                continue;


            const size1 =
                Number(p1.size) || 64;

            const size2 =
                Number(p2.size) || 64;


            const half1 =
                size1 / 2;

            const half2 =
                size2 / 2;


            let dx =
                Number(p1.x) -
                Number(p2.x);

            let dy =
                Number(p1.y) -
                Number(p2.y);


            let distance =
                Math.sqrt(
                    dx * dx +
                    dy * dy
                );


            const minDistance =
                half1 + half2;


            /*
               Игроки не соприкасаются.
            */

            if (distance >= minDistance)
                continue;


            /*
               Нормаль столкновения.
            */

            if (distance < 0.001) {

                const rvx =
                    (Number(p1.vx) || 0) -
                    (Number(p2.vx) || 0);

                const rvy =
                    (Number(p1.vy) || 0) -
                    (Number(p2.vy) || 0);


                const relativeSpeed =
                    Math.sqrt(
                        rvx * rvx +
                        rvy * rvy
                    );


                if (relativeSpeed > 0.001) {

                    dx =
                        rvx / relativeSpeed;

                    dy =
                        rvy / relativeSpeed;

                } else {

                    dx = 1;
                    dy = 0;
                }

            } else {

                dx /= distance;
                dy /= distance;
            }


            const nx = dx;
            const ny = dy;


            /*
               Скорости.
            */

            const v1x =
                Number(p1.vx) || 0;

            const v1y =
                Number(p1.vy) || 0;

            const v2x =
                Number(p2.vx) || 0;

            const v2y =
                Number(p2.vy) || 0;


            /*
               Относительная скорость
               вдоль нормали.

               > 0 = приближаются.
               <= 0 = уже разлетаются.
            */

            const relativeNormalVelocity =
                (v1x - v2x) * nx +
                (v1y - v2y) * ny;


            /*
               Сначала обязательно
               раздвигаем игроков.
            */

            const overlap =
                minDistance - distance;


            if (overlap > 0) {

                const push =
                    overlap / 2 + 0.5;


                p1.x +=
                    nx * push;

                p1.y +=
                    ny * push;


                p2.x -=
                    nx * push;

                p2.y -=
                    ny * push;
            }


            /*
               Если игроки уже разлетаются,
               второй раз не отскакиваем.
            */

            if (
                relativeNormalVelocity <= 0
            ) {
                continue;
            }


            /*
               СКОРОСТЬ ПОСЛЕ СТОЛКНОВЕНИЯ.

               Используем обычный упругий
               обмен скоростью вдоль нормали.

               Касательная скорость сохраняется.
            */

            const impulse =
                relativeNormalVelocity;


            p1.vx =
                v1x -
                impulse * nx;

            p1.vy =
                v1y -
                impulse * ny;


            p2.vx =
                v2x +
                impulse * nx;

            p2.vy =
                v2y +
                impulse * ny;


            /*
               Ограничение скорости.
            */

            const MAX_PLAYER_SPEED = 500;


            const speed1 =
                Math.sqrt(
                    p1.vx * p1.vx +
                    p1.vy * p1.vy
                );


            const speed2 =
                Math.sqrt(
                    p2.vx * p2.vx +
                    p2.vy * p2.vy
                );


            if (
                speed1 > MAX_PLAYER_SPEED
            ) {

                p1.vx =
                    p1.vx /
                    speed1 *
                    MAX_PLAYER_SPEED;

                p1.vy =
                    p1.vy /
                    speed1 *
                    MAX_PLAYER_SPEED;
            }


            if (
                speed2 > MAX_PLAYER_SPEED
            ) {

                p2.vx =
                    p2.vx /
                    speed2 *
                    MAX_PLAYER_SPEED;

                p2.vy =
                    p2.vy /
                    speed2 *
                    MAX_PLAYER_SPEED;
            }
        }
    }
}

/* =====================================================
   СЕРВЕРНАЯ ФИЗИКА
===================================================== */

const SERVER_DT = 1 / 60;

setInterval(() => {

    const list =
        Object.values(players);


    /*
       Проверяем столкновения.
    */

    resolvePlayerCollisions();


    /*
       Рассылаем состояние только если
       есть игроки.
    */

    if (list.length > 0) {

        io.emit(
            "players:update",
            players
        );
    }

}, 1000 / 60);




/* =====================================================
   SOCKET.IO
===================================================== */

io.on(
    "connection",
    socket => {

        console.log(
            `Игрок подключён: ${socket.id}`
        );


        /* =================================================
           СОЗДАЁМ ИГРОКА
        ================================================= */

        players[socket.id] = {

            id:
                socket.id,

            x:
                200,

            y:
                250,

            vx:
                0,

            vy:
                0,

            size:
                64,

            nickname:
                "Игрок",

            pixels:
                null
        };


        /* =================================================
           ОТПРАВЛЯЕМ ИГРОКАМ СОСТОЯНИЕ
        ================================================= */

        socket.emit(
            "players:update",
            players
        );


        io.emit(
            "players:update",
            players
        );


        /* =================================================
           ИМЯ
        ================================================= */

        socket.on(
            "player:name",
            name => {

                if (
                    typeof name !==
                    "string"
                ) {
                    return;
                }


                name =
                    name.trim();


                if (!name) {
                    name = "Игрок";
                }


                name =
                    name.substring(
                        0,
                        20
                    );


                if (
                    players[socket.id]
                ) {

                    players[socket.id].nickname =
                        name;
                }


                io.emit(
                    "players:update",
                    players
                );
            }
        );


        /* =================================================
           ПОЗИЦИЯ И СКОРОСТЬ ИГРОКА
        ================================================= */

        socket.on(
            "player:move",
            data => {

                if (
                    !players[socket.id]
                ) {
                    return;
                }


                if (
                    !data ||
                    typeof data !==
                    "object"
                ) {
                    return;
                }


                const player =
                    players[socket.id];


                /* =================================================
                   КООРДИНАТЫ
                ================================================= */

                const x =
                    Number(data.x);

                const y =
                    Number(data.y);


                if (
                    Number.isFinite(x) &&
                    Number.isFinite(y)
                ) {

                    player.x =
                        Math.max(
                            -100000,
                            Math.min(
                                100000,
                                x
                            )
                        );

                    player.y =
                        Math.max(
                            -100000,
                            Math.min(
                                100000,
                                y
                            )
                        );
                }


                /* =================================================
                   СКОРОСТЬ
                ================================================= */

                const vx =
                    Number(data.vx);

                const vy =
                    Number(data.vy);


                if (
                    Number.isFinite(vx) &&
                    Number.isFinite(vy)
                ) {

                    player.vx =
                        Math.max(
                            -1000,
                            Math.min(
                                1000,
                                vx
                            )
                        );

                    player.vy =
                        Math.max(
                            -1000,
                            Math.min(
                                1000,
                                vy
                            )
                        );
                }


                /* =================================================
                   НИК
                ================================================= */

                if (
                    typeof data.nickname ===
                    "string"
                ) {

                    player.nickname =
                        data.nickname
                            .trim()
                            .substring(
                                0,
                                20
                            ) ||
                        "Игрок";
                }


                /* =================================================
                   PIXELS
                ================================================= */

                const cleanPixels =
                    sanitizePixels(
                        data.pixels
                    );


                if (cleanPixels) {

                    player.pixels =
                        cleanPixels;
                }


                /* =================================================
                   РАЗМЕР
                ================================================= */

                const size =
                    Number(data.size);


                if (
                    Number.isFinite(size)
                ) {

                    player.size =
                        Math.max(
                            16,
                            Math.min(
                                256,
                                size
                            )
                        );
                }
            }
        );


        /* =================================================
           CHAT
        ================================================= */

        socket.on(
            "chat:message",
            message => {

                if (
                    typeof message !==
                    "string"
                ) {
                    return;
                }


                message =
                    message.trim();


                if (!message) {
                    return;
                }


                if (
                    message.length > 200
                ) {

                    message =
                        message.substring(
                            0,
                            200
                        );
                }


                io.emit(
                    "chat:message",
                    {

                        id:
                            socket.id,

                        username:
                            players[socket.id]
                                ?.nickname ||
                            "Игрок",

                        message:

                            message,

                        time:
                            Date.now()
                    }
                );
            }
        );


        /* =================================================
           ОТКЛЮЧЕНИЕ
        ================================================= */

        socket.on(
            "disconnect",
            reason => {

                delete players[
                    socket.id
                ];


                io.emit(
                    "player:left",
                    socket.id
                );


                io.emit(
                    "players:update",
                    players
                );


                console.log(
                    `Игрок отключён: ${socket.id} (${reason})`
                );
            }
        );
    }
);


/* =====================================================
   API ИГРОКОВ
===================================================== */

app.get(
    "/api/players",
    (req, res) => {

        const search =
            String(
                req.query.search ||
                ""
            )
            .trim()
            .toLowerCase();


        let result =
            Object.values(
                players
            );


        if (search) {

            result =
                result.filter(
                    player => {

                        const username =
                            String(
                                player.nickname ||
                                ""
                            )
                            .toLowerCase();


                        const id =
                            String(
                                player.id ||
                                ""
                            )
                            .toLowerCase();


                        return (
                            username.includes(
                                search
                            ) ||
                            id.includes(
                                search
                            )
                        );
                    }
                );
        }


        res.json(
            result
        );
    }
);


/* =====================================================
   ГЛАВНАЯ СТРАНИЦА
===================================================== */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            path.join(
                __dirname,
                "BOUNCE.html"
            )
        );
    }
);


/* =====================================================
   FALLBACK
===================================================== */

app.use(
    (req, res, next) => {

        if (
            req.method !==
            "GET"
        ) {
            return next();
        }


        res.sendFile(
            path.join(
                __dirname,
                "BOUNCE.html"
            )
        );
    }
);


/* =====================================================
   START
===================================================== */

server.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "================================"
        );

        console.log(
            " SERVER ЗАПУЩЕН"
        );

        console.log(
            ` PORT: ${PORT}`
        );

        console.log(
            " PLAYERS: ONLINE"
        );

        console.log(
            "================================"
        );

        console.log("");
    }
);
