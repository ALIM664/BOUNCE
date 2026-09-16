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

/*
Максимальный размер данных куба.
*/

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
SOCKET.IO
===================================================== */

io.on("connection", socket => {

console.log(
    `Игрок подключён: ${socket.id}`
);


/*
   Создаём игрока.
*/

players[socket.id] = {

    id: socket.id,

    x: 200,

    y: 250,

    size: 64,

    nickname: "Игрок",

    pixels: null
};


/*
   Сразу отправляем подключившемуся
   список остальных игроков.
*/

socket.emit(
    "players:update",
    players
);


/*
   И сообщаем всем,
   что появился новый игрок.
*/

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
   ПОЗИЦИЯ ИГРОКА
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
            Number.isFinite(x) &&
            Number.isFinite(y)
        ) {

            /*
               Защита от слишком
               больших координат.
            */

            players[socket.id].x =
                Math.max(
                    -100000,
                    Math.min(
                        100000,
                        x
                    )
                );

            players[socket.id].y =
                Math.max(
                    -100000,
                    Math.min(
                        100000,
                        y
                    )
                );
        }


        /*
           Ник.
        */

        if (
            typeof data.nickname ===
            "string"
        ) {

            players[socket.id].nickname =
                data.nickname
                    .trim()
                    .substring(
                        0,
                        20
                    ) ||
                "Игрок";
        }


        /*
           Куб.
        */

        const cleanPixels =
            sanitizePixels(
                data.pixels
            );

        if (cleanPixels) {

            players[socket.id].pixels =
                cleanPixels;
        }


        /*
           Размер игрока.
        */

        const size =
            Number(data.size);

        if (
            Number.isFinite(size)
        ) {

            players[socket.id].size =
                Math.max(
                    16,
                    Math.min(
                        256,
                        size
                    )
                );
        }


        /*
           Отправляем всем
           актуальное состояние.
        */

        io.emit(
            "players:update",
            players
        );
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


});

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
