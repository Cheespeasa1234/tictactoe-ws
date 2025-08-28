import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";

const app = express();
const server = createServer(app);
const io = new Server(server);

type GameState = "win1" | "win2" | "tie" | "playing" | "waiting" | "disconnect";
type PlayerType = "p1" | "p2" | "srv";

class Room {
    roomcode: string;
    
    board: number[];
    turn: number;
    gameState: GameState;

    player1: Socket;
    player2: Socket;

    constructor(roomcode: string) {
        this.roomcode = roomcode;
        this.board = [0,0,0,0,0,0,0,0,0];
        this.turn = 0;
        this.gameState = "waiting";
    }

    player1Connected(): boolean {
        return this.player1 !== undefined;
    }

    player2Connected(): boolean {
        return this.player2 !== undefined;
    }

    getStateGameOver(): boolean {
        return this.gameState === "win1" ||
            this.gameState === "win2" ||
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
        if (this.turn % 2 == 0) return 1;
        else if (this.turn % 2 == 1) return 2;
        return 0;
    }

    removePlayers(): void {
        this.player1.rooms.delete(this.roomcode);
        this.player2.rooms.delete(this.roomcode);
    }

    socketJoin(socket: Socket): number {
        if (!this.player1Connected()) {
            this.player1 = socket;
            socket.join(this.roomcode);
            this.sendGameState();
            return 1;
        } else if (!this.player2Connected()) {
            this.player2 = socket;
            socket.join(this.roomcode);
            this.sendGameState();
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

    socketMadeMove(socket: Socket, location: number): { success: boolean, message: string } {
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
        this.sendGameState();
        return { success: true, message: "Move accepted" };
    }

    socketSentMessage(socket: Socket, msg: string) {
        const team = this.getSocketTeam(socket);
        io.to(this.roomcode).emit("chat", { from: team, msg: msg });
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
        
        const room: Room = new Room(roomcode);
        rooms.set(roomcode, room);
        room.socketJoin(socket);

        socket.emit("status", { success: true, message: "Room created." });
    });

    socket.on("joinroom", (roomcode: string) => {
        const room = rooms.get(roomcode);
        if (!room) {
            socket.emit("status", { success: false, message: "Room not found." });
            return;
        }

        const joined = room.socketJoin(socket);
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

        socket.emit("status", room.socketMadeMove(socket, location));
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

        room.socketSentMessage(socket, msg);
    });
});

app.use(express.static("public_html"));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("server running at http://localhost:" + PORT);
});
