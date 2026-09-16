const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

/* =====================================================
   НАСТРОЙКИ
===================================================== */

const PORT =
    process.env.PORT || 3000;

const app =
    express();

const server =
    http.createServer(app);

const io =
    new Server(server, {
        cors: {
            origin: true,
            credentials: true
        }
    });


/* =====================================================
   ФАЙЛ ДАННЫХ
===================================================== */

const DATA_FILE =
    path.join(
        __dirname,
        "players.json"
    );


/*
   Загружаем игроков из файла.
*/

let savedPlayers = {};


function loadPlayersFile() {

    try {

        if (
            !fs.existsSync(
                DATA_FILE
            )
        ) {

            savedPlayers = {};

            return;
        }


        const data =
            fs.readFileSync(
                DATA_FILE,
                "utf8"
            );


        if (!data.trim()) {

            savedPlayers = {};

            return;
        }


        const parsed =
            JSON.parse(data);


        if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {

            savedPlayers =
                parsed;

        } else {

            savedPlayers = {};
        }


        console.log(
            `Загружено игроков: ${
                Object.keys(savedPlayers).length
            }`
        );

    } catch (error) {

        console.error(
            "Ошибка загрузки players.json:",
            error
        );

        savedPlayers = {};
    }
}


function savePlayersFile() {

    try {

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                savedPlayers,
                null,
                2
            ),
            "utf8"
        );

    } catch (error) {

        console.error(
            "Ошибка сохранения players.json:",
            error
        );
    }
}


loadPlayersFile();


/* =====================================================
   MIDDLEWARE
===================================================== */

app.use(
    express.json({
        limit: "1mb"
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
    express.static(
        __dirname
    )
);


/* =====================================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
===================================================== */


/*
   Проверка куба 8x8.
*/

function isValidCubePixels(
    pixels
) {

    if (
        !Array.isArray(pixels) ||
        pixels.length !== 8
    ) {

        return false;
    }


    for (
        let y = 0;
        y < 8;
        y++
    ) {

        if (
            !Array.isArray(
                pixels[y]
            ) ||
            pixels[y].length !== 8
        ) {

            return false;
        }


        for (
            let x = 0;
            x < 8;
            x++
        ) {

            const pixel =
                pixels[y][x];


            /*
               Пустой пиксель.
            */

            if (pixel === null)
                continue;


            if (
                typeof pixel !== "object"
            ) {

                return false;
            }


            const r =
                Number(pixel.r);

            const g =
                Number(pixel.g);

            const b =
                Number(pixel.b);

            const a =
                Number(pixel.a);


            if (
                !Number.isFinite(r) ||
                !Number.isFinite(g) ||
                !Number.isFinite(b) ||
                !Number.isFinite(a)
            ) {

                return false;
            }


            if (
                r < 0 ||
                r > 255 ||
                g < 0 ||
                g > 255 ||
                b < 0 ||
                b > 255 ||
                a < 0 ||
                a > 1
            ) {

                return false;
            }
        }
    }


    return true;
}


/*
   Нормализуем куб.
*/

function normalizeCubePixels(
    pixels
) {

    if (
        !isValidCubePixels(
            pixels
        )
    ) {

        return null;
    }


    return pixels.map(row =>
        row.map(pixel => {

            if (!pixel)
                return null;


            return {

                r:
                    Math.max(
                        0,
                        Math.min(
                            255,
                            Number(pixel.r)
                        )
                    ),

                g:
                    Math.max(
                        0,
                        Math.min(
                            255,
                            Number(pixel.g)
                        )
                    ),

                b:
                    Math.max(
                        0,
                        Math.min(
                            255,
                            Number(pixel.b)
                        )
                    ),

                a:
                    Math.max(
                        0,
                        Math.min(
                            1,
                            Number(pixel.a)
                        )
                    )
            };
        })
    );
}


/*
   Безопасное имя.
*/

function normalizeName(
    name
) {

    if (
        typeof name !== "string"
    ) {

        return "Игрок";
    }


    name =
        name.trim();


    if (!name) {

        return "Игрок";
    }


    return name.substring(
        0,
        20
    );
}


/*
   Создаём публичные данные игрока.

   ВАЖНО:
   Не отправляем сюда внутренние данные.
*/

function getPublicPlayer(
    socket
) {

    return {

        id:
            socket.id,

        name:
            socket.playerName ||
            "Игрок",

        nickname:
            socket.playerName ||
            "Игрок",

        x:
            Number(socket.playerX) ||
            200,

        y:
            Number(socket.playerY) ||
            250,

        size:
            50,

        pixels:
            socket.cubePixels ||
            null
    };
}


/*
   Возвращаем всех подключённых игроков.
*/

function getOnlinePlayers() {

    const result = [];


    for (
        const socket of
        io.sockets.sockets.values()
    ) {

        result.push(
            getPublicPlayer(
                socket
            )
        );
    }


    return result;
}


/*
   Отправляем всем текущих игроков.
*/

function broadcastPlayers() {

    io.emit(
        "players:update",
        getOnlinePlayers()
    );
}


/* =====================================================
   SOCKET.IO
===================================================== */

io.on(
    "connection",
    socket => {

        console.log(
            `Игрок подключён: ${socket.id}`
        );


        /*
           Начальные значения.
        */

        socket.playerName =
            "Игрок";

        socket.playerX =
            200;

        socket.playerY =
            250;

        socket.cubePixels =
            null;


        /* =================================================
           СОХРАНЁННЫЕ ДАННЫЕ
        ================================================= */


        /*
           Если у тебя позже появится
           авторизация с настоящим user.id,
           сюда можно будет подставить его.
           
           Сейчас идентификатор пользователя —
           socket.id.
        */


        /*
           Сразу сообщаем клиенту,
           что Socket.IO авторизован.
           
           Это совместимо с твоим кодом:
           
           socket.on("auth:success", user => ...)
        */

        socket.emit(
            "auth:success",
            {
                id:
                    socket.id,

                username:
                    socket.playerName,

                cubePixels:
                    socket.cubePixels,

                level:
                    1
            }
        );


        /* =================================================
           ИМЯ ИГРОКА
        ================================================= */

        socket.on(
            "player:name",
            name => {

                socket.playerName =
                    normalizeName(
                        name
                    );


                /*
                   Сохраняем имя
                   по socket.id.
                */

                if (
                    !savedPlayers[
                        socket.id
                    ]
                ) {

                    savedPlayers[
                        socket.id
                    ] = {};
                }


                savedPlayers[
                    socket.id
                ].username =
                    socket.playerName;


                savePlayersFile();


                /*
                   Старый формат,
                   который уже был у тебя.
                */

                io.emit(
                    "player:update",
                    {
                        id:
                            socket.id,

                        name:
                            socket.playerName
                    }
                );


                /*
                   Новый формат.
                */

                broadcastPlayers();
            }
        );


        /* =================================================
           СОХРАНЕНИЕ КУБА
        ================================================= */

        socket.on(
            "cube:save",
            data => {

                if (
                    !data ||
                    typeof data !== "object"
                ) {

                    socket.emit(
                        "cube:saved",
                        {
                            success: false,
                            error:
                                "Некорректные данные"
                        }
                    );

                    return;
                }


                const cubePixels =
                    normalizeCubePixels(
                        data.pixels
                    );


                if (!cubePixels) {

                    console.warn(
                        `Некорректный куб от ${socket.id}`
                    );


                    socket.emit(
                        "cube:saved",
                        {
                            success: false,
                            error:
                                "Куб должен быть 8x8"
                        }
                    );

                    return;
                }


                /*
                   Храним куб в socket,
                   чтобы передавать его
                   другим игрокам.
                */

                socket.cubePixels =
                    cubePixels;


                /*
                   Сохраняем в файл.
                */

                if (
                    !savedPlayers[
                        socket.id
                    ]
                ) {

                    savedPlayers[
                        socket.id
                    ] = {};
                }


                savedPlayers[
                    socket.id
                ].username =
                    socket.playerName ||
                    "Игрок";


                savedPlayers[
                    socket.id
                ].cubePixels =
                    cubePixels;


                savePlayersFile();


                /*
                   Отвечаем клиенту.
                */

                socket.emit(
                    "cube:saved",
                    {
                        success: true
                    }
                );


                /*
                   Остальным игрокам
                   показываем новый куб.
                */

                broadcastPlayers();


                console.log(
                    `Куб сохранён: ${socket.id}`
                );
            }
        );


        /* =================================================
           ДВИЖЕНИЕ ИГРОКА
        ================================================= */

        socket.on(
            "player:move",
            data => {

                if (
                    !data ||
                    typeof data !== "object"
                ) {

                    return;
                }


                /*
                   Координаты.
                */

                const x =
                    Number(data.x);

                const y =
                    Number(data.y);


                if (
                    !Number.isFinite(x) ||
                    !Number.isFinite(y)
                ) {

                    return;
                }


                /*
                   Защита от NaN
                   и слишком больших координат.
                */

                socket.playerX =
                    Math.max(
                        -100000,
                        Math.min(
                            100000,
                            x
                        )
                    );


                socket.playerY =
                    Math.max(
                        -100000,
                        Math.min(
                            100000,
                            y
                        )
                    );


                /*
                   Ник.
                */

                if (
                    typeof data.nickname ===
                    "string"
                ) {

                    socket.playerName =
                        normalizeName(
                            data.nickname
                        );
                }


                /*
                   Если клиент передал
                   новый куб — проверяем его.
                */

                if (
                    Array.isArray(
                        data.pixels
                    )
                ) {

                    const cube =
                        normalizeCubePixels(
                            data.pixels
                        );


                    if (cube) {

                        socket.cubePixels =
                            cube;
                    }
                }


                /*
                   Отправляем позицию всем.
                */

                broadcastPlayers();
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


                if (!message)
                    return;


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
                            socket.playerName ||
                            "Игрок",

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

                /*
                   Старое событие,
                   которое уже использовал
                   твой клиент.
                */

                io.emit(
                    "player:remove",
                    {
                        id:
                            socket.id
                    }
                );


                /*
                   Новое событие.
                */

                io.emit(
                    "player:left",
                    socket.id
                );


                console.log(
                    `Игрок отключён: ${
                        socket.id
                    } (${reason})`
                );
            }
        );


        /* =================================================
           НОВЫЙ ИГРОК
        ================================================= */

        /*
           Отправляем ему уже подключённых
           игроков.
        */

        socket.emit(
            "players:update",
            getOnlinePlayers()
        );


        /*
           И сообщаем остальным,
           что появился новый игрок.
        */

        broadcastPlayers();
    }
);


/* =====================================================
   API: СПИСОК ИГРОКОВ
===================================================== */

app.get(
    "/api/players",
    (req, res) => {

        try {

            const search =
                String(
                    req.query.search ||
                    ""
                )
                .trim()
                .toLowerCase();


            const players = [];


            /*
               Сначала добавляем
               сохранённых игроков.
            */

            for (
                const id in savedPlayers
            ) {

                const saved =
                    savedPlayers[id];


                if (
                    !saved ||
                    typeof saved !==
                    "object"
                ) {

                    continue;
                }


                const username =
                    normalizeName(
                        saved.username ||
                        "Игрок"
                    );


                /*
                   Поиск.
                */

                if (search) {

                    const idText =
                        String(id)
                            .toLowerCase();


                    const nameText =
                        username
                            .toLowerCase();


                    if (
                        !nameText.includes(
                            search
                        ) &&
                        !idText.includes(
                            search
                        )
                    ) {

                        continue;
                    }
                }


                players.push({

                    id,

                    username,

                    name:
                        username,

                    rank:
                        saved.rank ||
                        "Игрок",

                    cubePixels:
                        saved.cubePixels ||
                        null
                });
            }


            /*
               Для онлайн игроков
               используем актуальные данные.
            */

            for (
                const socket of
                io.sockets.sockets.values()
            ) {

                const id =
                    socket.id;


                const existing =
                    players.find(
                        player =>
                            player.id === id
                    );


                const onlinePlayer =
                    getPublicPlayer(
                        socket
                    );


                if (existing) {

                    existing.username =
                        onlinePlayer.nickname;

                    existing.name =
                        onlinePlayer.nickname;

                    existing.cubePixels =
                        onlinePlayer.pixels;

                } else {

                    players.push({

                        id,

                        username:
                            onlinePlayer.nickname,

                        name:
                            onlinePlayer.nickname,

                        rank:
                            "Игрок",

                        cubePixels:
                            onlinePlayer.pixels
                    });
                }
            }


            res.json(
                players
            );

        } catch (error) {

            console.error(
                "API PLAYERS ERROR:",
                error
            );


            res.status(500)
                .json({
                    error:
                        "Ошибка загрузки игроков"
                });
        }
    }
);


/* =====================================================
   API: СОХРАНЕНИЕ НИКА
===================================================== */

app.post(
    "/api/player/name",
    (req, res) => {

        const id =
            String(
                req.body.id ||
                ""
            );


        const username =
            normalizeName(
                req.body.username
            );


        if (!id) {

            return res
                .status(400)
                .json({
                    error:
                        "Не указан id"
                });
        }


        if (
            !savedPlayers[id]
        ) {

            savedPlayers[id] =
                {};
        }


        savedPlayers[id]
            .username =
            username;


        savePlayersFile();


        res.json({
            success: true
        });
    }
);


/* =====================================================
   API: СОХРАНЕНИЕ КУБА
===================================================== */

app.post(
    "/api/player/cube",
    (req, res) => {

        const id =
            String(
                req.body.id ||
                ""
            );


        const cubePixels =
            normalizeCubePixels(
                req.body.cubePixels
            );


        if (!id) {

            return res
                .status(400)
                .json({
                    error:
                        "Не указан id"
                });
        }


        if (!cubePixels) {

            return res
                .status(400)
                .json({
                    error:
                        "Некорректный куб"
                });
        }


        if (
            !savedPlayers[id]
        ) {

            savedPlayers[id] =
                {};
        }


        savedPlayers[id]
            .cubePixels =
            cubePixels;


        savePlayersFile();


        res.json({
            success: true
        });
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
            ` DATA: ${DATA_FILE}`
        );

        console.log(
            "================================"
        );

        console.log("");
    }
);
