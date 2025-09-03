const VALUE_X = 1;
const VALUE_O = 2;
const VALUE_BLANK = 0;

const roomInputElement = document.getElementById("room");
const joinRoomButtonElement = document.getElementById("join-room-btn");
const createRoomButtonElement = document.getElementById("create-room-btn");
const boardContainerElement = document.getElementById("board-container");
const voteToContinueContainerElement = document.getElementById("vote-to-continue-container");
const voteToContinueButtonElement = document.getElementById("vote-to-continue-btn");
const joinRoomContainerElement = document.getElementById("join-room-panel");

const turnCounterElement = document.getElementById("turn");
const teamDisplayElement = document.getElementById("team");
const gameStateDisplayElement = document.getElementById("game-state");
const gameInfoContainerElement = document.getElementById("game-info");

const sendMessageButtonElement = document.getElementById("send-message-btn");
const messageInputElement = document.getElementById("message");
const chatDisplayElement = document.getElementById("chat");

let myTeam;
let chatHistory = [];

const socket = io();
socket.onAny((eventName, ...args) => {
    console.log("recieved " + eventName + ": " + JSON.stringify(args));
});

socket.on("status", (data) => {
    const { success, message } = data;
    handleChat({ from: 0, msg: message });
});

socket.on("resetchat", () => {
    chatHistory = [];
});

socket.on("roomstatus", (room) => {
    const { code, player1Connected, player2Connected, board, turn, gameState, gameStateOver, gameStateInProgress, yourTeam, yourTurn } = room;
    
    joinRoomContainerElement.classList.remove("d-block");
    joinRoomContainerElement.classList.add("d-none");
    gameInfoContainerElement.classList.remove("d-none");
    gameInfoContainerElement.classList.add("d-flex");

    setBoard(board);
    turnCounterElement.innerText = turn;
    teamDisplayElement.innerText = yourTurn;
    gameStateDisplayElement.innerText = gameState;
    myTeam = yourTeam;

    if (gameState === "win" || gameState === "tie") {
        voteToContinueContainerElement.style.display = "block";
        voteToContinueButtonElement.setAttribute("disabled", true);
    }
});

function handleChat(data) {
    const from = data.from;
    const msg = data.msg;
    const time = data.time;

    if (from === 0) {
        chatHistory.push({ id: from, time: time, from: "System", msg: msg });
    } else if (myTeam === 0) {
        chatHistory.push({ id: from, time: time, from: "Player" + from, msg: msg });
    } else {
        chatHistory.push({ id: from, time: time, from: myTeam === from ? "You" : "Opponent", msg: msg });
    }

    chatDisplayElement.innerHTML = "";
    for (const chatMsg of chatHistory) {
        const e = document.createElement("div");
        e.classList.add("chat-message");
        if (chatMsg.id === 0) {
            e.classList.add("chat-system-message");
        }

        const text = document.createElement("span");
        text.innerText = chatMsg.from + ": " + chatMsg.msg;
        e.appendChild(text);
        
        if  (chatMsg.time) {
            const time = document.createElement("span");
            time.classList.add("chat-message-time");
            time.innerText = chatMsg.time;
            e.appendChild(time);
        }
        

        chatDisplayElement.appendChild(e);
    }
    chatDisplayElement.scrollTop = chatDisplayElement.scrollHeight;
}

socket.on("chat", handleChat);

function createXIcon() {
    const div = document.createElement("div");
    div.classList.add("icon", "icon-x");
    div.innerHTML = `<i class="fa-solid fa-xmark tx${myTeam}"></i>`
    return div;
}
function createOIcon() {
    const div = document.createElement("div");
    div.classList.add("icon", "icon-o");
    div.innerHTML = `<i class="fa-solid fa-o to${myTeam}"></i>`
    return div;
}
function createIcon(team) {
    if (team == VALUE_X) {
        return createXIcon();
    } else if (team == VALUE_O) {
        return createOIcon();
    } else {
        return document.createElement("div");
    }
}

function createTicTacToeBoard(board) {
    const div = document.createElement("div");
    div.classList.add("board");
    for (let i = 0; i < 9; i++) {
        const tile = document.createElement("div");
        tile.classList.add("tile");
        tile.classList.add("tile" + i);
        let icon = createIcon(board[i]);
        tile.appendChild(icon);
        tile.addEventListener("click", () => {
            socket.emit("move", i);
        });
        div.appendChild(tile);
    }
    return div;
}

function setBoard(board) {
    boardContainerElement.innerHTML = "";
    boardContainerElement.appendChild(createTicTacToeBoard(board));
}

joinRoomButtonElement.addEventListener("click", () => {
    socket.emit("joinroom", roomInputElement.value);
});

createRoomButtonElement.addEventListener("click", () => {
    socket.emit("createroom", roomInputElement.value);
});

// setInterval(() => {
//     socket.emit("chat", "spam test");
// }, 100);

function activateMessageSend() {
    socket.emit("chat", messageInputElement.value);
    messageInputElement.value = "";
}

sendMessageButtonElement.addEventListener("click", activateMessageSend);

messageInputElement.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey && messageInputElement.value.trim().length > 0) {
        activateMessageSend();
    }
});

voteToContinueButtonElement.addEventListener("click", () => {
    socket.emit("votetocontinue");
    voteToContinueButtonElement.removeAttribute("disabled");
});