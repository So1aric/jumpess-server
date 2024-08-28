Deno.serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response(null, { status: 501 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  socket.addEventListener("open", () => {
    console.log("a client connected");
  });

  socket.addEventListener("close", () => {
    for (const [roomName, _] of rooms.entries()) {
      if (Array.from(conns.values()).includes(socket)) {
        rooms.delete(roomName);

        channel.postMessage({
          type: "delete_room",
          roomName,
        });
      }
    }
  });

  socket.addEventListener("message", (event) => {
    const { type, content } = JSON.parse(event.data);

    switch (type) {
      case "connect":
        {
          processConnect(socket, content);
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
  });

  return response;
});

const channel = new BroadcastChannel("messages");
channel.onmessage = (event) => {
  const message = event.data;
  console.log('---------\n', message, rooms, '==========\n')

  switch (message.type) {
    case "new_room":
      {
        rooms.set(message.roomName, [message.uuid, ""]);
      }
      break;

    case "enter_room":
      {
        rooms.get(message.roomName)![1] = message.uuid;
      }
      break;

    case "delete_room":
      {
        rooms.delete(message.roomName);
      }
      break;

    case "ice_offer":
      {
        if (conns.has(message.peerID)) {
          conns.get(message.peerID)!.send(JSON.stringify({
            type: "ice_offer",
            sdp: message.sdp,
          }));
        }
      }
      break;

    case "ice_answer":
      {
        if (conns.has(message.peerID)) {
          conns.get(message.peerID)!.send(JSON.stringify({
            type: "ice_answer",
            sdp: message.sdp,
          }));
        }
      }
      break;
  }
};

const rooms = new Map<string, [string, string]>();
const conns = new Map<string, WebSocket>();

const processConnect = (
  socket: WebSocket,
  { roomName }: { roomName: string },
) => {
  // Create a uuid for the current connection
  const uuid = crypto.randomUUID();

  // Register the connection
  conns.set(uuid, socket);

  // Inform the client
  socket.send(JSON.stringify({
    type: "connected",
    uuid,
    ready: rooms.has(roomName),
  }));

  if (!rooms.has(roomName)) {
    // We create a room
    rooms.set(roomName, [uuid, ""]);

    // Tell it to other workers
    channel.postMessage({
      type: "new_room",
      roomName,
      uuid,
    });
  } else {
    // We fill the blank in the current created room
    // TODO: check if the room is full
    rooms.get(roomName)![1] = uuid;

    // Tell it to other workers
    channel.postMessage({
      type: "enter_room",
      roomName,
      uuid,
    });
  }
};

const processIceOffer = (
  _: WebSocket,
  { roomName, uuid, sdp }: { roomName: string; uuid: string; sdp: any },
) => {
  const room = rooms.get(roomName)!;
  const peerID = room[0] === uuid ? room[1] : room[0];

  if (conns.has(peerID)) {
    conns.get(peerID)!.send(JSON.stringify({
      type: "ice_offer",
      sdp,
    }));
  } else {
    channel.postMessage({
      type: "ice_offer",
      peerID,
      sdp,
    });
  }
};

const processIceAnswer = (
  _: WebSocket,
  { roomName, uuid, sdp }: { roomName: string; uuid: string; sdp: any },
) => {
  const room = rooms.get(roomName)!;
  const peerID = room[0] === uuid ? room[1] : room[0];

  if (conns.has(peerID)) {
    conns.get(peerID)!.send(JSON.stringify({
      type: "ice_answer",
      sdp,
    }));
  } else {
    channel.postMessage({
      type: "ice_answer",
      peerID,
      sdp,
    });
  }
};
