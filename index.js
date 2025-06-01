const net = require('net');

const SERVER_PORT = 25565;

function writeVarInt(value) {
  let bytes = [];
  while (true) {
    let temp = value & 0b01111111;
    value >>>= 7;
    if (value !== 0) {
      temp |= 0b10000000;
    }
    bytes.push(temp);
    if (value === 0) break;
  }
  return Buffer.from(bytes);
}

const server = net.createServer((socket) => {
  // 1. Record the time when the connection is made:
  const startTime = Date.now();

  socket.once('data', () => {
    // 2. Compute latency (in ms):
    const latency = Date.now() - startTime;

    // 3. Build a fresh JSON‐object (so we can inject "latency"):
    const responseObj = {
      version: {
        name: "https://educatedsuddenbucket.is-a.dev/",
        protocol: 47
      },
      players: {
        max: 100,
        online: 53,
        sample: [
          {
            name: "EducatedSuddenBucket",
            id: "00000000-0000-0000-0000-000000000000"
          }
        ]
      },
      description: {
        text: "Sigma"
      },
      // 4. Inject the computed latency (in milliseconds):
    };

    const jsonResponse = Buffer.from(JSON.stringify(responseObj));
    const lengthPrefix = writeVarInt(jsonResponse.length);

    // Minecraft status packet (0x00) + length of JSON + JSON
    const packet = Buffer.concat([
      writeVarInt(0),       // packet ID = 0 (status response)
      lengthPrefix,         // VarInt length of JSON
      jsonResponse
    ]);

    // Prepend full packet length
    const fullPacket = Buffer.concat([
      writeVarInt(packet.length),
      packet
    ]);

    socket.write(fullPacket, () => {
      socket.end();
    });
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
    socket.destroy();
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.listen(SERVER_PORT, () => {
  console.log(`Server running on port ${SERVER_PORT}`);
});
