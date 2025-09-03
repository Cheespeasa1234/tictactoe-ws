import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import dateFormat from "dateformat";

const app = express();
const server = createServer(app);
const io = new Server(server);

type GameState = "win" | "tie" | "playing" | "waiting" | "disconnect";
type Status = { success: boolean, message: string };

class PlayerBase {
    socket?: Socket;
    connected: boolean;
    constructor() {
        this.socket = undefined;
        this.connected = false;
    }

    getConnected(): this is { socket: Socket } {
        return this.connected && this.socket !== undefined;
    }
}

class RoomBase {
    roomcode: string;
    playerCount: number;
    players: PlayerBase[];

    constructor(roomcode: string, playerCount: number) {
        this.roomcode = roomcode;
        this.playerCount = playerCount;
        this.players = new Array(playerCount);
        for (let i = 0; i < this.players.length; i++) {
            this.players[i] = new PlayerBase();
        }
    }

    getSocketPlayer(socket: Socket): PlayerBase | undefined {
        // Find the player they are
        const player: PlayerBase | undefined = this.players.find(p => {
            if (p.getConnected()) {
                return p.socket.id === socket.id;
            }
            return false;
        });
        return player;
    }
}

class TicTacToePlayer extends PlayerBase {
    team: number;

    toString(): string {
        return `TicTacToePlayer[socket.id="${this.socket?.id.substring(0,4)}...",connected=${this.connected},team=${this.team}]`;
    }
}

class TicTacToeRoom extends RoomBase {
    
    players: TicTacToePlayer[];

    board: number[];
    turn: number;

    gameState: GameState;
    winTeam: number;
    winId: number;

    constructor(roomcode: string) {
        super(roomcode, 2);
        this.players = new Array(2);
        for (let i = 0; i < this.players.length; i++) {
            this.players[i] = new TicTacToePlayer();
        }
        this.handleReset();
    }

    /**
     * Returns the player that a socket is represented by, from the list of players using a search
     * @param socket The socket to look for
     * @returns The player they are
     */
    override getSocketPlayer(socket: Socket): TicTacToePlayer | undefined {
        return super.getSocketPlayer(socket) as TicTacToePlayer | undefined;
    }

    getStateGameOver(): boolean {
        return this.gameState === "win" ||
            this.gameState === "tie" ||
            this.gameState === "disconnect";
    }

    getStateGameInProgress(): boolean {
        return this.gameState === "playing";
    }

    sendGameState(): void {
        const sharedData = {
            
            code: this.roomcode,
            
            player1Connected: this.players[0].getConnected(),
            player2Connected: this.players[1].getConnected(),
            board: this.board,
            turn: this.turn,

            gameState: this.gameState,
            gameStateOver: this.getStateGameOver(),
            gameStateInProgress: this.getStateGameInProgress(),
            winTeam: this.winTeam,
            winId: this.winId,

        };

        if (this.players[0].getConnected()) {
            this.players[0].socket.emit("roomstatus", {
                ...sharedData,
                yourTeam: 1,
                yourTurn: this.getStateGameInProgress() && this.getTeamTurn() == 1,
            });
        }

        if (this.players[1].getConnected()) {
            this.players[1].socket.emit("roomstatus", {
                ...sharedData,
                yourTeam: 2,
                yourTurn: this.getStateGameInProgress() && this.getTeamTurn() == 2,
            });
        }
    }

    /**
     * Returns which team is their turn.
     */
    getTeamTurn(): number {
        if (!this.getStateGameInProgress()) return 0;
        else if (this.turn % 2 == 0) return 1;
        else if (this.turn % 2 == 1) return 2;
        return 0;
    }

    removePlayers(): void {
        if (this.players[0].getConnected()) {
            sendStatusToSocket(this.players[0].socket, { success: false, message: "Room disconnecting" });
            this.players[0].socket.rooms.delete(this.roomcode);
        }
        if (this.players[1].getConnected()) {
            sendStatusToSocket(this.players[1].socket, { success: false, message: "Room disconnecting" });
            this.players[1].socket.rooms.delete(this.roomcode);
        }
    }

    /**
     * Connects a socket to the room, adds them as a player, and returns what team they joined.
     * @param socket The socket to connect to the room with
     * @returns The team they joined. 1 and 2 are X and O, and 0 is other or error.
     */
    handleSocketJoin(socket: Socket): number {
        // find the player slot they can join
        for (let i = 0; i < this.players.length; i++) {
            if (!this.players[i].getConnected()) {
                this.players[i].socket = socket;
                this.players[i].team = i + 1;
                this.players[i].connected = true;
                socket.join(this.roomcode);
                socket.emit("resetchat");
                this.gameState = "waiting";
                this.sendGameState();
                sendStatusToRoom(this.roomcode, { success: true, message: `${this.players[i].toString()} joined`})
                return this.players[i].team;
            }
        }
        return 0;
    }

    getSocketTeam(socket: Socket): number | undefined {
        const p: TicTacToePlayer | undefined = this.getSocketPlayer(socket);
        return p?.team;
    }

    handleSocketDisconnect(socket: Socket) {
        const player: TicTacToePlayer | undefined = this.getSocketPlayer(socket);
        if (player) {
            player.connected = false;
            player.socket = undefined;
            player.team = 0;
        }
    }

    handleDetectWinOrTie() {
        // check for win or tie
        for (let i = 0; i < 3; i++) {
            const id = i * 3;
            const hor = this.board[id] !== 0 && this.board[id] === this.board[1 + id] && this.board[1 + id] === this.board[2 + id];
            const ver = this.board[i] !== 0 && this.board[i] === this.board[3 + i] && this.board[3 + i] === this.board[6 + i];

            if (hor) {
                if (this.board[id] === 1) {
                    console.log("win1 hor");
                    this.gameState = "win";
                    this.winTeam = 1;
                    this.winId = i;
                    return;
                } else if (this.board[id] === 2) {
                    console.log("win2 hor");
                    this.gameState = "win";
                    this.winTeam = 2;
                    this.winId = i;
                    return;
                }
            } else if (ver) {
                if (this.board[i] === 1) {
                    console.log("win1 ver");
                    this.gameState = "win";
                    this.winTeam = 1;
                    this.winId = 3 + i;
                    return;
                } else if (this.board[id] === 2) {
                    console.log("win2 ver");
                    this.gameState = "win";
                    this.winTeam = 2;
                    this.winId = 3 + i;
                    return;
                }
            }
        }

        const dia1 = this.board[0] === this.board[4] && this.board[4] === this.board[8];
        const dia2 = this.board[6] === this.board[4] && this.board[4] === this.board[2];

        if (dia1 || dia2) {
            if (this.board[4] === 1) {
                console.log("win1 dia");
                this.gameState = "win";
                this.winTeam = 1;
                this.winId = 7;
                return;
            } else if (this.board[4] === 2) {
                console.log("win2 dia");
                this.gameState = "win";
                this.winTeam = 2;
                this.winId = 8;
                return;
            }
        }

        let foundZero = false;
        for (let i = 0; i < 9; i++) {
            if (this.board[i] === 0) {
                foundZero = true;
                break;
            }
        }

        if (!foundZero) {
            this.gameState = "tie";
            return;
        }
        
    }

    handleSocketMadeMove(socket: Socket, location: number): Status {
        // figure out what team they are
        const player = this.getSocketPlayer(socket);
        if (player === undefined) {
            return { success: false, message: "Not a member of this room" };
        }
        
        const team: number = player.team;
        if (this.getTeamTurn() !== team) {
            return { success: false, message: `Not your team (${team})'s turn` };
        }

        if (location < 0 || location > 8) {
            return { success: false, message: "Invalid move: location out of bounds" };
        }

        if (this.board[location] !== 0) {
            return { success: false, message: "Invalid move: space occupied" };
        }

        this.board[location] = team;
        this.turn++;

        this.handleDetectWinOrTie();

        this.sendGameState();
        return { success: true, message: "Move accepted" };
    }

    handleSocketSentMessage(socket: Socket, msg: string): Status {
        const player = this.getSocketPlayer(socket);
        if (!player) {
            return { success: false, message: "Not a member" };
        }
        const time = dateFormat(new Date(), "h:MM:ss");
        io.to(this.roomcode).emit("chat", { time: time, from: player.team, msg: msg });
        return { success: true, message: "Sent message" }
    }

    handleReset() {
        this.board = [0,0,0,0,0,0,0,0,0];
        this.turn = 0;
        this.gameState = "waiting";
        this.winTeam = 0;
        this.winId = -1;
    }
}

const rooms: Map<string, TicTacToeRoom> = new Map();

function sendStatusToSocket(socket: Socket, status: Status) {
    socket.emit("status", status); 
}

function sendStatusToRoom(roomcode: string, status: Status) {
    io.to(roomcode).emit("status", status);
}

io.on("connection", (socket: Socket) => {
    const name = socket.id.substring(0,4);
    console.log(`${name}: connection`);
    
    socket.onAny((eventName, ...args) => {
        console.log(`${name}: ${eventName}, ${JSON.stringify(args)}`);
    });

    socket.on("disconnecting", () => {
        console.log(`${name}: disconnecting`);
        for (const roomcode of socket.rooms) {
            if (roomcode === socket.id) continue;
            const room = rooms.get(roomcode);
            if (room) {
                room.handleSocketDisconnect(socket);
                room.gameState = "disconnect";
                sendStatusToRoom(roomcode, { success: false, message: "Player disconnected." });
            }
        }
    });

    socket.on("createroom", (roomcode: string) => {
        if (socket.rooms.size > 1) {
            sendStatusToSocket(socket, { success: false, message: "Already in a room." });
            return;
        }
        if (rooms.has(roomcode)) {
            sendStatusToSocket(socket, { success: false, message: "Room code already taken." });
            return;
        }
        
        if (roomcode.length === 0) {
            sendStatusToSocket(socket, { success: false, message: "Invalid room code." });
            return;
        }
        
        const room: TicTacToeRoom = new TicTacToeRoom(roomcode);
        rooms.set(roomcode, room);
        room.handleSocketJoin(socket);

        sendStatusToSocket(socket, { success: true, message: "Room created." });
    });

    socket.on("joinroom", (roomcode: string) => {
        if (socket.rooms.size > 1) {
            sendStatusToSocket(socket, { success: false, message: "Already in a room." });
            return;
        }
        if (roomcode.length === 0) {
            sendStatusToSocket(socket, { success: false, message: "Invalid room code." });
            return;    
        }
        const room = rooms.get(roomcode);
        if (!room) {
            sendStatusToSocket(socket, { success: false, message: "Room not found." });
            return;
        }

        const joined = room.handleSocketJoin(socket);
        if (joined == 0) {
            sendStatusToSocket(socket, { success: false, message: "Room is full." });
            return;
        }

        if (room.players[0] !== undefined && room.players[1] !== undefined && room.gameState === "waiting") {
            // start the game
            room.handleReset();
            room.gameState = "playing";
        }
        
        sendStatusToSocket(socket, { success: true, message: "Joined room." });
        room.sendGameState();
    });

    socket.on("move", (location: number) => {
        const [roomcode] = Array.from(socket.rooms).filter(r => r !== socket.id);
        if (!roomcode) {
            sendStatusToSocket(socket, { success: false, message: "Not in a room." });
            return;
        }
        
        const room = rooms.get(roomcode);
        if (!room) {
            sendStatusToSocket(socket, { success: false, message: "Room does not exist." });
            return;
        }

        sendStatusToSocket(socket, room.handleSocketMadeMove(socket, location));
    });

    socket.on("chat", (msg) => {
        const [roomcode] = Array.from(socket.rooms).filter(r => r !== socket.id);
        if (!roomcode) {
            sendStatusToSocket(socket, { success: false, message: "Not in a room." });
            return;
        }
        
        const room = rooms.get(roomcode);
        if (!room) {
            sendStatusToSocket(socket, { success: false, message: "Room does not exist." });
            return;
        }

        room.handleSocketSentMessage(socket, msg);
    });
});

app.use(express.static("public_html"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("server running at http://localhost:" + PORT);
});
