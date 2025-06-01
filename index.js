const net = require('net');

const SERVER_STATUS = {
    version: {
        name: 'HeatBlock 1.20.1',
        protocol: 763
    },
    players: {
        max: 20,
        online: 1,
        sample: [{
            name: "EducatedSuddenBucket",
            id: "00000000-0000-0000-0000-000000000000"
          }]
    },
    description: {
        text: 'https://heatblock.esb.is-a.dev/'
    }
};
function writeVarInt(value) {
    const bytes = [];
    while (value >= 0x80) {
        bytes.push((value & 0x7F) | 0x80);
        value >>>= 7;
    }
    bytes.push(value & 0x7F);
    return Buffer.from(bytes);
}

function readVarInt(buffer, offset = 0) {
    let value = 0;
    let position = 0;
    let currentByte;
    
    do {
        if (offset + position >= buffer.length) {
            throw new Error('VarInt is too long');
        }
        
        currentByte = buffer[offset + position];
        value |= (currentByte & 0x7F) << (position * 7);
        
        if (position++ >= 5) {
            throw new Error('VarInt is too long');
        }
    } while ((currentByte & 0x80) !== 0);
    
    return { value, length: position };
}

function writeString(str) {
    const strBuffer = Buffer.from(str, 'utf8');
    const lengthBuffer = writeVarInt(strBuffer.length);
    return Buffer.concat([lengthBuffer, strBuffer]);
}

function handleHandshake(data) {
    try {
        let offset = 0;
        const packetLength = readVarInt(data, offset);
        offset += packetLength.length;
        const packetId = readVarInt(data, offset);
        offset += packetId.length;
        
        if (packetId.value !== 0x00) {
            return null;
        }
        
        const protocolVersion = readVarInt(data, offset);
        offset += protocolVersion.length;
        const addressLength = readVarInt(data, offset);
        offset += addressLength.length;
        const address = data.slice(offset, offset + addressLength.value).toString('utf8');
        offset += addressLength.value;
        const port = data.readUInt16BE(offset);
        offset += 2;
        const nextState = readVarInt(data, offset);
        
        return {
            protocolVersion: protocolVersion.value,
            address,
            port,
            nextState: nextState.value
        };
    } catch (error) {
        return null;
    }
}

function createPacket(packetId, data = Buffer.alloc(0)) {
    const packetIdBuffer = writeVarInt(packetId);
    const packetData = Buffer.concat([packetIdBuffer, data]);
    const packetLength = writeVarInt(packetData.length);
    return Buffer.concat([packetLength, packetData]);
}

const server = net.createServer((socket) => {
    let state = 'handshake';
    let buffer = Buffer.alloc(0);
    
    socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        
        try {
            if (state === 'handshake') {
                const handshake = handleHandshake(buffer);
                if (handshake) {
                    if (handshake.nextState === 1) {
                        state = 'status';
                        buffer = Buffer.alloc(0);
                    } else if (handshake.nextState === 2) {
                        socket.end();
                        return;
                    }
                }
            } else if (state === 'status') {
                if (buffer.length >= 1) {
                    try {
                        const packetLength = readVarInt(buffer, 0);
                        
                        if (buffer.length >= packetLength.length + packetLength.value) {
                            const packetId = readVarInt(buffer, packetLength.length);
                            
                            if (packetId.value === 0x00) {
                                const responseData = writeString(JSON.stringify(SERVER_STATUS));
                                const responsePacket = createPacket(0x00, responseData);
                                socket.write(responsePacket);
                                
                            } else if (packetId.value === 0x01) {
                                const pingData = buffer.slice(packetLength.length + packetId.length, packetLength.length + packetLength.value);
                                const pongPacket = createPacket(0x01, pingData);
                                socket.write(pongPacket);
                                
                                setTimeout(() => {
                                    socket.end();
                                }, 100);
                            }
                            
                            buffer = buffer.slice(packetLength.length + packetLength.value);
                        }
                    } catch (error) {
                        socket.end();
                    }
                }
            }
        } catch (error) {
            socket.end();
        }
    });
    
    socket.on('error', () => {});
});

server.listen(25565, () => {
    console.log('Minecraft ping server started on port 25565');
});

