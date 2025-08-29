import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import dateFormat from "dateformat";

const app = express();
const server = createServer(app);
const io = new Server(server);

type GameState = "win" | "tie" | "playing" | "waiting" | "disconnect";
type PlayerType = "p1" | "p2" | "srv";

class Room {
    roomcode: string;
    
    board: number[];
    turn: number;

    gameState: GameState;
    winTeam: number;
    winId: number;

    player1: Socket;
    player2: Socket;

    constructor(roomcode: string) {
        this.roomcode = roomcode;
        this.board = [0,0,0,0,0,0,0,0,0];
        this.turn = 0;
        this.gameState = "waiting";
        this.winTeam = 0;
        this.winId = -1;
    }

    player1Connected(): boolean {
        return this.player1 !== undefined;
    }

    player2Connected(): boolean {
        return this.player2 !== undefined;
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
            
            player1Connected: this.player1Connected(),
            player2Connected: this.player2Connected(),
            board: this.board,
            turn: this.turn,

            gameState: this.gameState,
            gameStateOver: this.getStateGameOver(),
            gameStateInProgress: this.getStateGameInProgress(),
            winTeam: this.winTeam,
            winId: this.winId,

        };

        if (this.player1Connected()) {
            this.player1.emit("roomstatus", {
                ...sharedData,
                yourTeam: 1,
                yourTurn: this.getStateGameInProgress() && this.getTeamTurn() == 1,
            });
        }

        if (this.player2Connected()) {
            this.player2.emit("roomstatus", {
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
        if (this.player1 !== undefined) {
            this.player1.rooms.delete(this.roomcode);
        }
        if (this.player2 !== undefined) {
            this.player2.rooms.delete(this.roomcode);
        }
    }

    /**
     * Connects a socket to the room, adds them as a player, and returns what team they joined.
     * @param socket The socket to connect to the room with
     * @returns The team they joined. 1 and 2 are X and O, and 0 is other or error.
     */
    handleSocketJoin(socket: Socket): number {
        if (!this.player1Connected()) {
            this.player1 = socket;
            socket.join(this.roomcode);
            this.sendGameState();

            if (this.player2Connected()) {
                this.player2.emit("status", { success: true, message: "Opponent joined the room." });
            }
            return 1;
        } else if (!this.player2Connected()) {
            this.player2 = socket;
            socket.join(this.roomcode);
            this.sendGameState();

            if (this.player1Connected()) {
                this.player1.emit("status", { success: true, message: "Opponent joined the room." });
            }
            return 2;
        } else {
            return 0;
        }
    }

    getSocketTeam(socket: Socket): number {
        if (socket.id === this.player1.id) {
            return 1;
        } else if (socket.id === this.player2.id) {
            return 2;
        } else {
            return 0;
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

    handleSocketMadeMove(socket: Socket, location: number): { success: boolean, message: string } {
        // figure out what team they are
        const team = this.getSocketTeam(socket);
        if (team === 0) {
            return { success: false, message: "Not a member of this room" };
        }
        
        if (this.getTeamTurn() !== team) {
            return { success: false, message: "Not your team's turn" };
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

    handleSocketSentMessage(socket: Socket, msg: string): void {
        const team = this.getSocketTeam(socket);
        const time = dateFormat(new Date(), "h:MM:ss");
        io.to(this.roomcode).emit("chat", { time: time, from: team, msg: msg });
    }
}

const rooms: Map<string, Room> = new Map();

io.on("connection", (socket: Socket) => {
    console.log("a user connected");

    socket.on("disconnecting", () => {
        for (const roomcode of socket.rooms) {
            if (roomcode === socket.id) continue;
            const room = rooms.get(roomcode);
            if (room) {
                room.gameState = "disconnect";
                room.sendGameState();
                room.removePlayers();
                rooms.delete(roomcode);
            }
        }
    });

    socket.on("createroom", (roomcode: string) => {
        if (socket.rooms.size > 1) {
            socket.emit("status", { success: false, message: "Already in a room." });
            return;
        }
        if (rooms.has(roomcode)) {
            socket.emit("status", { success: false, message: "Room code already taken." });
            return;
        }
        
        if (roomcode.length === 0) {
            socket.emit("status", { success: false, message: "Invalid room code." });
            return;    
        }
        
        const room: Room = new Room(roomcode);
        rooms.set(roomcode, room);
        room.handleSocketJoin(socket);

        socket.emit("status", { success: true, message: "Room created." });
    });

    socket.on("joinroom", (roomcode: string) => {
        if (socket.rooms.size > 1) {
            socket.emit("status", { success: false, message: "Already in a room." });
            return;
        }
        if (roomcode.length === 0) {
            socket.emit("status", { success: false, message: "Invalid room code." });
            return;    
        }
        const room = rooms.get(roomcode);
        if (!room) {
            socket.emit("status", { success: false, message: "Room not found." });
            return;
        }

        const joined = room.handleSocketJoin(socket);
        if (joined == 0) {
            socket.emit("status", { success: false, message: "Room is full." });
            return;
        }

        if (room.player1Connected() && room.player2Connected() && room.gameState === "waiting") {
            // start the game
            room.gameState = "playing";
        }
        
        socket.emit("status", { success: true, message: "Joined room." });
        room.sendGameState();
    });

    socket.on("move", (location: number) => {
        const [roomcode] = Array.from(socket.rooms).filter(r => r !== socket.id);
        if (!roomcode) {
            socket.emit("status", { success: false, message: "Not in a room." });
            return;
        }
        
        const room = rooms.get(roomcode);
        if (!room) {
            socket.emit("status", { success: false, message: "Room does not exist." });
            return;
        }

        socket.emit("status", room.handleSocketMadeMove(socket, location));
    });

    socket.on("chat", (msg) => {
        const [roomcode] = Array.from(socket.rooms).filter(r => r !== socket.id);
        if (!roomcode) {
            socket.emit("status", { success: false, message: "Not in a room." });
            return;
        }
        
        const room = rooms.get(roomcode);
        if (!room) {
            socket.emit("status", { success: false, message: "Room does not exist." });
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
