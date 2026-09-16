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
        origin: true
    }
});


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
    express.static(__dirname)
);


/* =====================================================
   SOCKET.IO
===================================================== */

io.on("connection", socket => {

    console.log(
        `Игрок подключён: ${socket.id}`
    );


    /*
       Получение ника игрока.
    */

    socket.on("player:name", name => {

        if (typeof name !== "string") {
            return;
        }

        name = name.trim();

        if (!name) {
            name = "Игрок";
        }

        if (name.length > 20) {
            name = name.substring(0, 20);
        }

        socket.playerName = name;

        /*
           Сообщаем всем игрокам,
           что появился игрок.
        */

        io.emit("player:update", {
            id: socket.id,
            name: socket.playerName
        });
    });


    /* =================================================
       CHAT
    ================================================= */

    socket.on("chat:message", message => {

        if (typeof message !== "string") {
            return;
        }

        message = message.trim();

        if (!message) {
            return;
        }

        if (message.length > 200) {
            message = message.substring(0, 200);
        }

        io.emit("chat:message", {

            id: socket.id,

            username:
                socket.playerName ||
                "Игрок",

            message,

            time: Date.now()
        });
    });


    /* =================================================
       ОТКЛЮЧЕНИЕ
    ================================================= */

    socket.on("disconnect", reason => {

        io.emit("player:remove", {
            id: socket.id
        });

        console.log(
            `Игрок отключён: ${socket.id} (${reason})`
        );
    });

});


/* =====================================================
   ГЛАВНАЯ СТРАНИЦА
===================================================== */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "BOUNCE.html"
        )
    );
});


/* =====================================================
   FALLBACK
===================================================== */

app.use((req, res, next) => {

    if (req.method !== "GET") {
        return next();
    }

    res.sendFile(
        path.join(
            __dirname,
            "BOUNCE.html"
        )
    );
});


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
            "================================"
        );

        console.log("");
    }
);
