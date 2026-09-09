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
   ПАПКИ И ФАЙЛЫ
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


function createFileIfNotExists(file, defaultValue) {
    if (!fs.existsSync(file)) {
        fs.writeFileSync(
            file,
            JSON.stringify(
                defaultValue,
                null,
                2
            ),
            "utf8"
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
        const text = fs.readFileSync(
            file,
            "utf8"
        );

        if (!text.trim()) {
            return {};
        }

        return JSON.parse(text);

    } catch (error) {

        console.error(
            "Ошибка чтения JSON:",
            file,
            error
        );

        return {};
    }
}


function writeJson(file, data) {

    const tempFile =
        file + ".tmp";

    try {

        fs.writeFileSync(
            tempFile,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

        fs.renameSync(
            tempFile,
            file
        );

    } catch (error) {

        console.error(
            "Ошибка записи JSON:",
            file,
            error
        );

        try {
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch {}
    }
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
   STATIC
===================================================== */

app.use(
    express.static(
        __dirname
    )
);


/* =====================================================
   УТИЛИТЫ
===================================================== */

function normalizeUsername(username) {

    return String(
        username ?? ""
    )
        .trim()
        .toLowerCase();
}


function isValidUsername(username) {

    return (
        typeof username === "string" &&
        username.length > 0
    );
}


function isValidPassword(password) {

    return (
        typeof password === "string" &&
        password.length > 0
    );
}


/* =====================================================
   PLAYER ID
===================================================== */

function createPlayerId(users) {

    const ids =
        Object.values(users)
            .map(user => Number(user.id))
            .filter(
                id =>
                    Number.isInteger(id) &&
                    id > 0
            );

    if (ids.length === 0) {
        return 1;
    }

    return Math.max(...ids) + 1;
}


/* =====================================================
   МИГРАЦИЯ ID
===================================================== */

function migrateUserIds() {

    const users = getUsers();

    let changed = false;

    const usedIds = new Set();

    for (
        const user of
        Object.values(users)
    ) {

        const id =
            Number(user.id);

        if (
            Number.isInteger(id) &&
            id > 0
        ) {

            usedIds.add(id);
        }
    }


    let nextId =
        usedIds.size > 0
            ? Math.max(...usedIds) + 1
            : 1;


    const newUsers = {};


    for (
        const [key, user]
        of Object.entries(users)
    ) {

        let id =
            Number(user.id);


        if (
            !Number.isInteger(id) ||
            id < 1
        ) {

            while (
                usedIds.has(nextId)
            ) {
                nextId++;
            }

            id = nextId;

            usedIds.add(id);

            nextId++;

            changed = true;
        }


        user.id = id;


        /*
           Старые данные могли не иметь
           этих полей.
        */

        if (
            !Array.isArray(
                user.completedLevels
            )
        ) {

            user.completedLevels = [];

            changed = true;
        }


        if (
            typeof user.level !== "number"
        ) {

            user.level = 1;

            changed = true;
        }


        if (
            !Object.prototype.hasOwnProperty.call(
                user,
                "cubePixels"
            )
        ) {

            user.cubePixels = null;

            changed = true;
        }


        newUsers[
            String(id)
        ] = user;


        if (
            key !== String(id)
        ) {

            changed = true;
        }
    }


    if (changed) {

        saveUsers(
            newUsers
        );

        console.log(
            "Миграция пользователей выполнена."
        );
    }
}


migrateUserIds();


/* =====================================================
   SESSION
===================================================== */

const SESSION_COOKIE = "session";

const SESSION_TIME =
    1000 *
    60 *
    60 *
    24 *
    30;


function createSessionToken() {

    return crypto
        .randomBytes(32)
        .toString("hex");
}


function createSession(userId) {

    const sessions =
        getSessions();

    const token =
        createSessionToken();

    const now =
        Date.now();

    sessions[token] = {

        userId:
            Number(userId),

        createdAt:
            now,

        expiresAt:
            now + SESSION_TIME
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

    if (
        Object.prototype.hasOwnProperty.call(
            sessions,
            token
        )
    ) {

        delete sessions[token];

        saveSessions(
            sessions
        );
    }
}


function getSession(token) {

    if (
        !token ||
        typeof token !== "string"
    ) {

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
        !session.expiresAt ||
        Date.now() >
        Number(session.expiresAt)
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
   USER FROM REQUEST
===================================================== */

function getUserFromRequest(req) {

    const token =
        req.cookies[
            SESSION_COOKIE
        ];


    if (!token) {
        return null;
    }


    const session =
        getSession(token);


    if (!session) {
        return null;
    }


    const users =
        getUsers();


    const user =
        users[
            String(
                session.userId
            )
        ];


    if (!user) {

        /*
           Если пользователя больше нет,
           удаляем его сессию.
        */

        deleteSession(
            token
        );

        return null;
    }


    return user;
}


/* =====================================================
   COOKIE
===================================================== */

function setSessionCookie(
    res,
    token
) {

    res.cookie(
        SESSION_COOKIE,
        token,
        {
            httpOnly: true,

            sameSite: "lax",

            secure:
                process.env.NODE_ENV ===
                "production",

            maxAge:
                SESSION_TIME,

            path: "/"
        }
    );
}


function clearSessionCookie(res) {

    res.clearCookie(
        SESSION_COOKIE,
        {
            httpOnly: true,

            sameSite: "lax",

            secure:
                process.env.NODE_ENV ===
                "production",

            path: "/"
        }
    );
}


/* =====================================================
   PUBLIC USER
===================================================== */

function publicUser(user) {

    return {

        id:
            Number(user.id),

        username:
            user.username,

        level:
            Number(user.level || 1),

        completedLevels:
            Array.isArray(
                user.completedLevels
            )
                ? user.completedLevels
                : [],

        cubePixels:
            user.cubePixels ?? null
    };
}


/* =====================================================
   REQUIRE AUTH
===================================================== */

function requireAuth(
    req,
    res,
    next
) {

    const user =
        getUserFromRequest(req);


    if (!user) {

        return res
            .status(401)
            .json({
                error:
                    "Не авторизован"
            });
    }


    req.user =
        user;


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
                normalizeUsername(
                    username
                );


            if (
                !isValidUsername(
                    username
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Введите ник"
                    });
            }


            if (
                !isValidPassword(
                    password
                )
            ) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Введите пароль"
                    });
            }


            const users =
                getUsers();


            const alreadyExists =
                Object.values(users)
                    .some(
                        user =>
                            normalizeUsername(
                                user.username
                            ) ===
                            username
                    );


            if (alreadyExists) {

                return res
                    .status(409)
                    .json({
                        error:
                            "Такой ник уже занят"
                    });
            }


            const userId =
                createPlayerId(
                    users
                );


            const passwordHash =
                await bcrypt.hash(
                    password,
                    12
                );


            const user = {

                id:
                    userId,

                username,

                passwordHash,

                level:
                    1,

                completedLevels:
                    [],

                cubePixels:
                    null,

                createdAt:
                    Date.now(),

                updatedAt:
                    Date.now()
            };


            users[
                String(userId)
            ] = user;


            saveUsers(
                users
            );


            /*
               Создаём постоянную сессию
               на 30 дней.
            */

            const token =
                createSession(
                    userId
                );


            setSessionCookie(
                res,
                token
            );


            return res.json({

                success:
                    true,

                user:
                    publicUser(
                        user
                    )
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
                normalizeUsername(
                    username
                );


            if (
                !username ||
                typeof password !==
                    "string"
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
                            normalizeUsername(
                                u.username
                            ) ===
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


            const token =
                createSession(
                    user.id
                );


            setSessionCookie(
                res,
                token
            );


            return res.json({

                success:
                    true,

                user:
                    publicUser(
                        user
                    )
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
            getUserFromRequest(
                req
            );


        if (!user) {

            return res
                .status(401)
                .json({
                    authenticated:
                        false
                });
        }


        return res.json({

            authenticated:
                true,

            user:
                publicUser(
                    user
                )
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
            req.cookies[
                SESSION_COOKIE
            ];


        deleteSession(
            token
        );


        clearSessionCookie(
            res
        );


        return res.json({

            success:
                true
        });
    }
);


/* =====================================================
   ПОИСК ИГРОКОВ
===================================================== */

app.get(
    "/api/players",
    (req, res) => {

        const users =
            getUsers();


        const search =
            String(
                req.query.search ?? ""
            )
                .trim()
                .toLowerCase();


        let players =
            Object.values(users);


        if (search) {

            players =
                players.filter(
                    user => {

                        const id =
                            String(
                                user.id
                            );


                        const username =
                            String(
                                user.username ??
                                ""
                            )
                                .toLowerCase();


                        return (
                            id.includes(search) ||
                            username.includes(search)
                        );
                    }
                );
        }


        players.sort(
            (a, b) =>
                Number(a.id) -
                Number(b.id)
        );


        const result =
            players.map(
                user => ({

                    id:
                        Number(
                            user.id
                        ),

                    username:
                        user.username,

                    cubePixels:
                        user.cubePixels ?? null
                })
            );


        return res.json({

            success:
                true,

            players:
                result
        });
    }
);


/* =====================================================
   КОНКРЕТНЫЙ ИГРОК
===================================================== */

app.get(
    "/api/players/:id",
    (req, res) => {

        const id =
            Number(
                req.params.id
            );


        if (
            !Number.isInteger(id) ||
            id < 1
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Неверный ID"
                });
        }


        const users =
            getUsers();


        const user =
            users[
                String(id)
            ];


        if (!user) {

            return res
                .status(404)
                .json({
                    error:
                        "Игрок не найден"
                });
        }


        return res.json({

            success:
                true,

            player: {

                id:
                    Number(
                        user.id
                    ),

                username:
                    user.username,

                cubePixels:
                    user.cubePixels ?? null
            }
        });
    }
);


/* =====================================================
   SAVE LEVEL
===================================================== */

app.post(
    "/api/level/complete",
    requireAuth,
    (req, res) => {

        const level =
            Number(
                req.body.level
            );


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
            users[
                String(
                    req.user.id
                )
            ];


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


        if (
            !user.completedLevels.includes(
                level
            )
        ) {

            user.completedLevels.push(
                level
            );

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


        saveUsers(
            users
        );


        return res.json({

            success:
                true,

            user:
                publicUser(
                    user
                )
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
                    .headers
                    .cookie;


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
                            part.indexOf("=");


                        if (index === -1) {
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


                        try {

                            cookies[key] =
                                decodeURIComponent(
                                    value
                                );

                        } catch {

                            cookies[key] =
                                value;
                        }
                    }
                );


            const token =
                cookies[
                    SESSION_COOKIE
                ];


            if (!token) {

                return next(
                    new Error(
                        "Сессия отсутствует"
                    )
                );
            }


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
                    String(
                        session.userId
                    )
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
                    Number(
                        user.id
                    ),

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
            `Socket подключён: ${socket.user.username} [ID ${socket.user.id}]`
        );


        function getCurrentUser() {

            const users =
                getUsers();


            return users[
                String(
                    socket.user.id
                )
            ];
        }


        /* =================================================
           AUTH SUCCESS
        ================================================= */

        const user =
            getCurrentUser();


        if (!user) {

            socket.disconnect();

            return;
        }


        socket.emit(
            "auth:success",
            publicUser(
                user
            )
        );


        /* =================================================
           PROFILE
        ================================================= */

        socket.on(
            "profile:get",
            () => {

                const user =
                    getCurrentUser();


                if (!user) {
                    return;
                }


                socket.emit(
                    "profile",
                    publicUser(
                        user
                    )
                );
            }
        );


        /* =================================================
           SAVE CUBE
        ================================================= */

        socket.on(
            "cube:save",
            data => {

                try {

                    if (!data) {
                        return;
                    }


                    const pixels =
                        data.pixels;


                    /*
                       Куб должен быть 8x8.
                    */

                    if (
                        !Array.isArray(
                            pixels
                        ) ||
                        pixels.length !== 8
                    ) {

                        console.log(
                            "cube:save: неправильное количество строк"
                        );

                        return;
                    }


                    for (
                        const row
                        of pixels
                    ) {

                        if (
                            !Array.isArray(
                                row
                            ) ||
                            row.length !== 8
                        ) {

                            console.log(
                                "cube:save: неправильный размер строки"
                            );

                            return;
                        }
                    }


                    /*
                       Ограничиваем значения,
                       чтобы в JSON не попал мусор.
                    */

                    const cleanPixels =
                        pixels.map(
                            row =>
                                row.map(
                                    pixel => {

                                        if (
                                            pixel === null ||
                                            pixel === undefined
                                        ) {

                                            return null;
                                        }


                                        if (
                                            typeof pixel ===
                                            "string"
                                        ) {

                                            return pixel
                                                .substring(
                                                    0,
                                                    100
                                                );
                                        }


                                        return pixel;
                                    }
                                )
                        );


                    const users =
                        getUsers();


                    const user =
                        users[
                            String(
                                socket.user.id
                            )
                        ];


                    if (!user) {

                        socket.emit(
                            "cube:error",
                            {
                                error:
                                    "Пользователь не найден"
                            }
                        );

                        return;
                    }


                    user.cubePixels =
                        cleanPixels;


                    user.updatedAt =
                        Date.now();


                    saveUsers(
                        users
                    );


                    console.log(
                        `Куб сохранён: ${user.username} [ID ${user.id}]`
                    );


                    socket.emit(
                        "cube:saved",
                        {

                            success:
                                true,

                            pixels:
                                user.cubePixels
                        }
                    );


                } catch (error) {

                    console.error(
                        "CUBE SAVE ERROR:",
                        error
                    );


                    socket.emit(
                        "cube:error",
                        {
                            error:
                                "Ошибка сохранения куба"
                        }
                    );
                }
            }
        );


        /* =================================================
           GET CUBE
        ================================================= */

        socket.on(
            "cube:get",
            () => {

                const user =
                    getCurrentUser();


                if (!user) {
                    return;
                }


                socket.emit(
                    "cube:data",
                    {

                        pixels:
                            user.cubePixels ?? null
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
                    !Number.isInteger(level) ||
                    level < 1 ||
                    level > 5
                ) {

                    return;
                }


                const users =
                    getUsers();


                const user =
                    users[
                        String(
                            socket.user.id
                        )
                    ];


                if (!user) {
                    return;
                }


                if (
                    !Array.isArray(
                        user.completedLevels
                    )
                ) {

                    user.completedLevels = [];
                }


                if (
                    !user.completedLevels.includes(
                        level
                    )
                ) {

                    user.completedLevels.push(
                        level
                    );

                    user.completedLevels.sort(
                        (a, b) => a - b
                    );
                }


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

                        id:
                            Number(
                                socket.user.id
                            ),

                        username:
                            socket.user.username,

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
                    `Socket отключён: ${socket.user.username} [ID ${socket.user.id}] (${reason})`
                );
            }
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
