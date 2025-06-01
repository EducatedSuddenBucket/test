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
            return null;
        }
        
        currentByte = buffer[offset + position];
        value |= (currentByte & 0x7F) << (position * 7);
        
        if (position++ >= 5) {
            return null;
        }
    } while ((currentByte & 0x80) !== 0);
    
    return { value, length: position };
}

function writeString(str) {
    const strBuffer = Buffer.from(str, 'utf8');
    const lengthBuffer = writeVarInt(strBuffer.length);
    return Buffer.concat([lengthBuffer, strBuffer]);
}

function createPacket(packetId, data = Buffer.alloc(0)) {
    const packetIdBuffer = writeVarInt(packetId);
    const packetData = Buffer.concat([packetIdBuffer, data]);
    const packetLength = writeVarInt(packetData.length);
    return Buffer.concat([packetLength, packetData]);
}

function processPackets(buffer, state, socket) {
    let offset = 0;
    
    while (offset < buffer.length) {
        const packetLengthResult = readVarInt(buffer, offset);
        if (!packetLengthResult) break;
        
        const packetLength = packetLengthResult.value;
        const totalPacketSize = packetLengthResult.length + packetLength;
        
        if (buffer.length < offset + totalPacketSize) break;
        
        const packetData = buffer.slice(offset + packetLengthResult.length, offset + totalPacketSize);
        const packetIdResult = readVarInt(packetData, 0);
        
        if (!packetIdResult) {
            offset += totalPacketSize;
            continue;
        }
        
        if (state.current === 'handshake' && packetIdResult.value === 0x00) {
            let dataOffset = packetIdResult.length;
            
            const protocolVersion = readVarInt(packetData, dataOffset);
            if (!protocolVersion) break;
            dataOffset += protocolVersion.length;
            
            const addressLength = readVarInt(packetData, dataOffset);
            if (!addressLength) break;
            dataOffset += addressLength.length;
            
            if (packetData.length < dataOffset + addressLength.value + 2) break;
            dataOffset += addressLength.value + 2;
            
            const nextState = readVarInt(packetData, dataOffset);
            if (!nextState) break;
            
            if (nextState.value === 1) {
                state.current = 'status';
            } else {
                socket.end();
                return buffer.length;
            }
        }
        else if (state.current === 'status') {
            if (packetIdResult.value === 0x00) {
                const responseData = writeString(JSON.stringify(SERVER_STATUS));
                const responsePacket = createPacket(0x00, responseData);
                socket.write(responsePacket);
            }
            else if (packetIdResult.value === 0x01) {
                const pingData = packetData.slice(packetIdResult.length);
                const pongPacket = createPacket(0x01, pingData);
                socket.write(pongPacket);
                socket.end();
                return buffer.length;
            }
        }
        
        offset += totalPacketSize;
    }
    
    return offset;
}

const server = net.createServer((socket) => {
    let state = { current: 'handshake' };
    let buffer = Buffer.alloc(0);
    
    socket.setTimeout(5000);
    
    socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        
        try {
            const processed = processPackets(buffer, state, socket);
            if (processed > 0) {
                buffer = buffer.slice(processed);
            }
        } catch (error) {
            socket.destroy();
        }
    });
    
    socket.on('timeout', () => {
        socket.destroy();
    });
    
    socket.on('error', () => {
        socket.destroy();
    });
});

server.listen(25565, () => {
    console.log('Minecraft ping server started on port 25565');
});

server.on('error', (error) => {
    console.error('Server error:', error.message);
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
