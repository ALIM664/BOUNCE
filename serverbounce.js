const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");

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
   ПАПКИ
===================================================== */

const DATA_DIR = path.join(__dirname, "data");

const USERS_FILE = path.join(
    DATA_DIR,
    "users.json"
);

const SESSIONS_FILE = path.join(
    DATA_DIR,
    "sessions.json"
);


if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}


function createFileIfNotExists(
    file,
    defaultValue
) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(
                defaultValue,
                null,
                2
            )
        );
    }
}


createFileIfNotExists(
    USERS_FILE,
    {}
);

createFileIfNotExists(
    SESSIONS_FILE,
    {}
);


/* =====================================================
   DATABASE
===================================================== */

function readJson(file) {
    try {
        return JSON.parse(
            fs.readFileSync(
                file,
                "utf8"
            )
        );
    } catch (error) {
        console.error(
            "Ошибка чтения:",
            file,
            error
        );

        return {};
    }
}


function writeJson(
    file,
    data
) {
    fs.writeFileSync(
        file,
        JSON.stringify(
            data,
            null,
            2
        )
    );
}


function getUsers() {
    return readJson(
        USERS_FILE
    );
}


function saveUsers(users) {
    writeJson(
        USERS_FILE,
        users
    );
}


function getSessions() {
    return readJson(
        SESSIONS_FILE
    );
}


function saveSessions(sessions) {
    writeJson(
        SESSIONS_FILE,
        sessions
    );
}


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

app.use(
    cookieParser()
);


/* =====================================================
   STATIC FILES
===================================================== */

/*
   Папка public:

   public/
       BOUNCE.html
       sounds/
       css/
       js/
       ...
*/

app.use(
    express.static(
        path.join(
            __dirname,
        )
    )
);


/* =====================================================
   УТИЛИТЫ
===================================================== */

function normalizeUsername(username) {
    return String(username || "")
        .trim()
        .toLowerCase();
}


function isValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,20}$/
        .test(username);
}


function isValidPassword(password) {
    return (
        typeof password === "string" &&
        password.length >= 6 &&
        password.length <= 100
    );
}


function createId() {
    return crypto.randomUUID();
}


function createSessionToken() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}


/* =====================================================
   SESSION
===================================================== */

const SESSION_COOKIE = "session";

const SESSION_TIME =
    1000 * 60 * 60 * 24 * 30;


function createSession(userId) {
    const sessions =
        getSessions();

    const token =
        createSessionToken();

    sessions[token] = {
        userId,

        createdAt:
            Date.now(),

        expiresAt:
            Date.now() +
            SESSION_TIME
    };

    saveSessions(
        sessions
    );

    return token;
}


function deleteSession(token) {
    if (!token) {
        return;
    }

    const sessions =
        getSessions();

    delete sessions[token];

    saveSessions(
        sessions
    );
}


function getSession(token) {
    if (!token) {
        return null;
    }

    const sessions =
        getSessions();

    const session =
        sessions[token];

    if (!session) {
        return null;
    }


    if (
        Date.now() >
        session.expiresAt
    ) {
        delete sessions[token];

        saveSessions(
            sessions
        );

        return null;
    }


    return session;
}


/* =====================================================
   AUTH FROM REQUEST
===================================================== */

function getUserFromRequest(req) {
    const token =
        req.cookies[
            SESSION_COOKIE
        ];

    const session =
        getSession(token);

    if (!session) {
        return null;
    }


    const users =
        getUsers();

    const user =
        users[
            session.userId
        ];

    if (!user) {
        return null;
    }


    return user;
}



function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_TIME
    });
}

function clearSessionCookie(res) {
    res.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    });
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        level: user.level,
        completedLevels: user.completedLevels,
        cubePixels: user.cubePixels
    };
}

function requireAuth(req, res, next) {
    const user = getUserFromRequest(req);

    if (!user) {
        return res.status(401).json({
            error: "Не авторизован"
        });
    }

    req.user = user;
    next();
}



/* =====================================================
   REGISTER
===================================================== */

app.post(
    "/api/register",
    async (req, res) => {

        try {

            let {
                username,
                password
            } = req.body;


            username =
                normalizeUsername(username);


            /*
               Проверяем логин.
            */

            if (
                !isValidUsername(username)
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Логин: 3–20 символов, только a-z, 0-9 и _"
                    });
            }


            /*
               Проверяем пароль.
            */

            if (
                !isValidPassword(password)
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Пароль должен содержать 6–100 символов"
                    });
            }


            const users =
                getUsers();


            /*
               Проверяем существование
               пользователя.
            */

            const alreadyExists =
                Object.values(users)
                    .some(
                        user =>
                            user.username ===
                            username
                    );


            if (alreadyExists) {

                return res
                    .status(409)
                    .json({
                        error:
                            "Такой логин уже занят"
                    });
            }


            /*
               Создаём пользователя.
            */

            const userId =
                createId();


            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );


            const user = {

                id: userId,

                username,

                passwordHash,

                level: 1,

                completedLevels: [],

                cubePixels: null,

                createdAt:
                    Date.now(),

                updatedAt:
                    Date.now()
            };


            users[userId] =
                user;


            saveUsers(users);


            /*
               Автоматически
               авторизуем пользователя.
            */

            const token =
                createSession(userId);


            setSessionCookie(
                res,
                token
            );


            return res.json({

                success: true,

                user:
                    publicUser(user)
            });


        } catch (error) {

            console.error(
                "REGISTER ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Ошибка сервера"
                });
        }
    }
);



/* =====================================================
   LOGIN
===================================================== */

app.post(
    "/api/login",
    async (req, res) => {

        try {

            let {
                username,
                password
            } = req.body;


            username =
                normalizeUsername(username);


            if (
                !username ||
                typeof password !== "string"
            ) {

                return res
                    .status(401)
                    .json({
                        error:
                            "Неверный логин или пароль"
                    });
            }


            const users =
                getUsers();


            const user =
                Object.values(users)
                    .find(
                        u =>
                            u.username ===
                            username
                    );


            if (!user) {

                return res
                    .status(401)
                    .json({
                        error:
                            "Неверный логин или пароль"
                    });
            }


            const passwordCorrect =
                await bcrypt.compare(
                    password,
                    user.passwordHash
                );


            if (!passwordCorrect) {

                return res
                    .status(401)
                    .json({
                        error:
                            "Неверный логин или пароль"
                    });
            }


            /*
               Создаём новую сессию.
            */

            const token =
                createSession(
                    user.id
                );


            setSessionCookie(
                res,
                token
            );


            return res.json({

                success: true,

                user:
                    publicUser(user)
            });


        } catch (error) {

            console.error(
                "LOGIN ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Ошибка сервера"
                });
        }
    }
);



/* =====================================================
   CURRENT USER
===================================================== */

app.get(
    "/api/me",
    (req, res) => {

        const user =
            getUserFromRequest(req);


        if (!user) {

            return res
                .status(401)
                .json({
                    authenticated: false
                });
        }


        return res.json({

            authenticated: true,

            user:
                publicUser(user)
        });
    }
);



/* =====================================================
   LOGOUT
===================================================== */

app.post(
    "/api/logout",
    (req, res) => {

        const token =
            req.cookies[SESSION_COOKIE];


        /*
           Удаляем серверную сессию.
        */

        deleteSession(token);


        /*
           Удаляем cookie браузера.
        */

        clearSessionCookie(res);


        return res.json({
            success: true
        });
    }
);



/* =====================================================
   SAVE PROGRESS
===================================================== */

app.post(
    "/api/level/complete",
    requireAuth,
    (req, res) => {

        const level =
            Number(req.body.level);


        if (
            !Number.isInteger(level) ||
            level < 1 ||
            level > 5
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Неверный уровень"
                });
        }


        const users =
            getUsers();


        const user =
            users[req.user.id];


        if (!user) {

            return res
                .status(404)
                .json({
                    error:
                        "Пользователь не найден"
                });
        }


        if (
            !Array.isArray(
                user.completedLevels
            )
        ) {

            user.completedLevels = [];
        }


        /*
           Добавляем уровень,
           если он ещё не пройден.
        */

        if (
            !user.completedLevels.includes(level)
        ) {

            user.completedLevels.push(level);

            user.completedLevels.sort(
                (a, b) => a - b
            );
        }


        /*
           Открываем следующий уровень.
        */

        if (
            level >= user.level &&
            level < 5
        ) {

            user.level =
                level + 1;
        }


        user.updatedAt =
            Date.now();


        saveUsers(users);


        return res.json({

            success: true,

            user:
                publicUser(user)
        });
    }
);



/* =====================================================
   SOCKET.IO AUTH
===================================================== */

io.use(
    (socket, next) => {

        try {

            const cookieHeader =
                socket.handshake
                    .headers.cookie;


            if (!cookieHeader) {

                return next(
                    new Error(
                        "Не авторизован"
                    )
                );
            }


            const cookies = {};


            cookieHeader
                .split(";")
                .forEach(
                    part => {

                        const index =
                            part.indexOf(
                                "="
                            );


                        if (
                            index === -1
                        ) {
                            return;
                        }


                        const key =
                            part
                                .slice(
                                    0,
                                    index
                                )
                                .trim();


                        const value =
                            part
                                .slice(
                                    index + 1
                                )
                                .trim();


                        cookies[key] =
                            decodeURIComponent(
                                value
                            );
                    }
                );


            const token =
                cookies[
                    SESSION_COOKIE
                ];


            const session =
                getSession(
                    token
                );


            if (!session) {

                return next(
                    new Error(
                        "Сессия истекла"
                    )
                );
            }


            const users =
                getUsers();


            const user =
                users[
                    session.userId
                ];


            if (!user) {

                return next(
                    new Error(
                        "Пользователь не найден"
                    )
                );
            }


            socket.user = {

                id:
                    user.id,

                username:
                    user.username
            };


            next();


        } catch (error) {

            console.error(
                "SOCKET AUTH ERROR:",
                error
            );


            next(
                new Error(
                    "Ошибка авторизации"
                )
            );
        }
    }
);


/* =====================================================
   SOCKET.IO
===================================================== */

io.on(
    "connection",
    socket => {

        console.log(
            `Socket подключён: ${socket.user.username}`
        );


        const users =
            getUsers();

        const user =
            users[
                socket.user.id
            ];


        if (!user) {
            socket.disconnect();
            return;
        }


        /* =================================================
           AUTH SUCCESS
        ================================================= */

        socket.emit(
            "auth:success",
            {

                id:
                    user.id,

                username:
                    user.username,

                level:
                    user.level,

                completedLevels:
                    user.completedLevels,

                cubePixels:
                    user.cubePixels
            }
        );


        /* =================================================
           PROFILE
        ================================================= */

        socket.on(
            "profile:get",
            () => {

                const users =
                    getUsers();

                const user =
                    users[
                        socket.user.id
                    ];


                if (!user) {
                    return;
                }


                socket.emit(
                    "profile",
                    {

                        id:
                            user.id,

                        username:
                            user.username,

                        level:
                            user.level,

                        completedLevels:
                            user.completedLevels,

                        cubePixels:
                            user.cubePixels
                    }
                );
            }
        );


        /* =================================================
           SAVE CUBE
        ================================================= */

        socket.on(
            "cube:save",
            data => {

                if (!data) {
                    return;
                }


                const pixels =
                    data.pixels;


                if (
                    !Array.isArray(
                        pixels
                    ) ||
                    pixels.length !== 8
                ) {

                    return;
                }


                for (
                    const row of pixels
                ) {

                    if (
                        !Array.isArray(
                            row
                        ) ||
                        row.length !== 8
                    ) {

                        return;
                    }
                }


                const users =
                    getUsers();


                const user =
                    users[
                        socket.user.id
                    ];


                if (!user) {
                    return;
                }


                user.cubePixels =
                    pixels;

                user.updatedAt =
                    Date.now();


                saveUsers(
                    users
                );


                socket.emit(
                    "cube:saved",
                    {
                        success: true
                    }
                );
            }
        );


        /* =================================================
           COMPLETE LEVEL
        ================================================= */

        socket.on(
            "level:complete",
            level => {

                level =
                    Number(level);


                if (
                    !Number.isInteger(
                        level
                    ) ||
                    level < 1 ||
                    level > 5
                ) {

                    return;
                }


                const users =
                    getUsers();


                const user =
                    users[
                        socket.user.id
                    ];


                if (!user) {
                    return;
                }


                if (
                    !Array.isArray(
                        user.completedLevels
                    )
                ) {

                    user.completedLevels =
                        [];
                }


                if (
                    !user.completedLevels
                        .includes(level)
                ) {

                    user.completedLevels
                        .push(level);
                }


                /* =================================================
                   OPEN NEXT LEVEL
                ================================================= */

                if (
                    level >= user.level &&
                    level < 5
                ) {

                    user.level =
                        level + 1;
                }


                user.updatedAt =
                    Date.now();


                saveUsers(
                    users
                );


                socket.emit(
                    "level:completed",
                    {

                        level,

                        nextLevel:
                            user.level,

                        completedLevels:
                            user.completedLevels
                    }
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

                        username:
                            socket.user
                                .username,

                        message,

                        time:
                            Date.now()
                    }
                );
            }
        );


        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            "disconnect",
            reason => {

                console.log(
                    `Socket отключён: ${socket.user.username} (${reason})`
                );
            }
        );
    }
);


/* =====================================================
   ГЛАВНАЯ СТРАНИЦА
===================================================== */

/*
   ВАЖНО:
   Используем BOUNCE.html,
   а не index.html.

   Файл должен находиться здесь:

   public/BOUNCE.html
*/

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

/*
   Для остальных GET-запросов
   также отдаём BOUNCE.html.

   Здесь специально НЕТ "*"
   и "/*splat", чтобы не было
   ошибки path-to-regexp.
*/

app.use(
    (req, res, next) => {

        if (
            req.method !== "GET"
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
            "================================"
        );

        console.log("");
    }
);
