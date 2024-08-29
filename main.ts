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
          serial,
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

const serial = crypto.randomUUID();

const channel = new BroadcastChannel("messages");
channel.onmessage = (event) => {
  const message = event.data;
  console.log(message);

  if (message.serial === serial) return;

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

    case "query_room":
      {
        if (rooms.has(message.roomName)) {
          rooms.get(message.roomName)![1] = message.uuid;

          channel.postMessage({
            serial,
            type: "found_room",
            room: rooms.get(message.roomName)!,
            roomName: message.roomName,
            queryUUID: message.queryUUID,
          });
        }
      }
      break;

    case "found_room":
      {
        if (!queries.has(message.queryUUID)) break;

        const [handle, roomName, socket] = queries.get(message.queryUUID)!;
        clearTimeout(handle);
        rooms.set(roomName, message.room);

        socket.send(JSON.stringify({
          type: "connected",
          uuid: message.room[1],
          ready: true,
        }));
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

  if (!rooms.has(roomName)) {
    console.log("No room found. Should query.");

    const queryUUID = crypto.randomUUID();

    channel.postMessage({
      serial,
      type: "query_room",
      roomName,
      queryUUID,
      uuid,
    });

    const queryRoomName = roomName;
    const queryRoomHandle = setTimeout(() => {
      // We create a room
      rooms.set(roomName, [uuid, ""]);

      // Inform the client
      socket.send(JSON.stringify({
        type: "connected",
        uuid,
        ready: false,
      }));
    }, 500);

    queries.set(queryUUID, [queryRoomHandle, queryRoomName, socket]);
  } else {
    console.log("Found the room.");

    // We fill the blank in the current created room
    // TODO: check if the room is full
    rooms.get(roomName)![1] = uuid;

    // Tell it to other workers
    channel.postMessage({
      serial,
      type: "enter_room",
      roomName,
      uuid,
    });

    socket.send(JSON.stringify({
      type: "connected",
      uuid,
      ready: true,
    }));
  }
};

const queries = new Map<string, [number, string, WebSocket]>();

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
      serial,
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
      serial,
      type: "ice_answer",
      peerID,
      sdp,
    });
  }
};
