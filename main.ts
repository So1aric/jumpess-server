Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response(null, { status: 501 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.log("a client connected");
  });

  socket.addEventListener("close", () => {
    for (const [roomName, room] of rooms.entries()) {
      if (Array.from(room.values()).includes(socket)) {
        rooms.delete(roomName);
        break;
      }
    }
  });

  socket.addEventListener("message", (event) => {
    processMessage(socket, event.data);
    channel.postMessage(JSON.stringify({
      socket,
      data: event.data,
    }));
  });

  return response;
});

const processMessage = (socket: WebSocket, data: string) => {
  const { type, content } = JSON.parse(data);

  switch (type) {
    case "join":
      {
        processJoin(socket, content);
      }
      break;

    case "ice_offer":
      {
        processIceOffer(socket, content);
      }
      break;

    case "ice_answer":
      {
        processIceAnswer(socket, content);
      }
      break;
  }
};

const channel = new BroadcastChannel("messages");
channel.onmessage = (event) => {
  const { socket, data } = JSON.parse(event.data);

  processMessage(socket, data);
};

const rooms = new Map<string, Map<string, WebSocket>>();

interface BaseMessageContent {
  roomName: string;
  userId: string;
}

const processJoin = (
  socket: WebSocket,
  { roomName, userId }: BaseMessageContent,
) => {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, new Map());
    channel.postMessage(JSON.stringify({
      type: "join",
      roomName,
      userId,
    }));
  }

  const room = rooms.get(roomName)!;

  if (room.has(userId)) {
    socket.send(JSON.stringify({
      type: "answer_join",
      content: {
        status: "failure",
        reason: "userId unavailable",
      },
    }));
  } else {
    socket.send(JSON.stringify({
      type: "answer_join",
      content: {
        status: "success",
        users: Array.from(room.keys()),
      },
    }));

    room.set(userId, socket);
  }
};

interface IceMessageContent extends BaseMessageContent {
  target: string;
  sdp: string;
}

const processIceOffer = (
  _: WebSocket,
  { roomName, userId, target, sdp }: IceMessageContent,
) => {
  if (!rooms.has(roomName) || !rooms.get(roomName)?.has(userId)) return;
  const room = rooms.get(roomName)!;

  room.get(target)?.send(JSON.stringify({
    type: "ice_offer",
    content: {
      userId,
      sdp,
    },
  }));
};

const processIceAnswer = (
  _: WebSocket,
  { roomName, userId, target, sdp }: IceMessageContent,
) => {
  if (!rooms.has(roomName) || !rooms.get(roomName)?.has(userId)) return;
  const room = rooms.get(roomName)!;

  room.get(target)?.send(JSON.stringify({
    type: "ice_answer",
    content: {
      userId,
      sdp,
    },
  }));
};
