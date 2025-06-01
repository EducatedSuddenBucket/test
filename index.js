const net = require('net');

// Server configuration
const SERVER_PORT = 25565;
const SERVER_VERSION = '1.20.1';
const PROTOCOL_VERSION = 763;
const MAX_PLAYERS = 20;
const ONLINE_PLAYERS = 0;
const SERVER_DESCRIPTION = 'A Minecraft Ping-Only Server';

// Utility functions for Minecraft packet handling
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

function createStatusResponse() {
    const response = {
        version: {
            name: SERVER_VERSION,
            protocol: PROTOCOL_VERSION
        },
        players: {
            max: MAX_PLAYERS,
            online: ONLINE_PLAYERS,
            sample: []
        },
        description: {
            text: SERVER_DESCRIPTION
        }
    };
    
    return JSON.stringify(response);
}

function handleHandshake(data) {
    try {
        let offset = 0;
        
        // Read packet length
        const packetLength = readVarInt(data, offset);
        offset += packetLength.length;
        
        // Read packet ID (should be 0x00 for handshake)
        const packetId = readVarInt(data, offset);
        offset += packetId.length;
        
        if (packetId.value !== 0x00) {
            return null;
        }
        
        // Read protocol version
        const protocolVersion = readVarInt(data, offset);
        offset += protocolVersion.length;
        
        // Read server address length and address
        const addressLength = readVarInt(data, offset);
        offset += addressLength.length;
        const address = data.slice(offset, offset + addressLength.value).toString('utf8');
        offset += addressLength.value;
        
        // Read server port
        const port = data.readUInt16BE(offset);
        offset += 2;
        
        // Read next state
        const nextState = readVarInt(data, offset);
        
        return {
            protocolVersion: protocolVersion.value,
            address,
            port,
            nextState: nextState.value
        };
    } catch (error) {
        console.log('Error parsing handshake:', error.message);
        return null;
    }
}

function createPacket(packetId, data = Buffer.alloc(0)) {
    const packetIdBuffer = writeVarInt(packetId);
    const packetData = Buffer.concat([packetIdBuffer, data]);
    const packetLength = writeVarInt(packetData.length);
    return Buffer.concat([packetLength, packetData]);
}

// Create the server
const server = net.createServer((socket) => {
    console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
    
    let state = 'handshake';
    let buffer = Buffer.alloc(0);
    
    socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        
        try {
            if (state === 'handshake') {
                const handshake = handleHandshake(buffer);
                if (handshake) {
                    console.log('Handshake received:', handshake);
                    
                    if (handshake.nextState === 1) {
                        state = 'status';
                        buffer = Buffer.alloc(0);
                    } else if (handshake.nextState === 2) {
                        // Login state - we don't handle this, just close
                        console.log('Login attempt - closing connection');
                        socket.end();
                        return;
                    }
                }
            } else if (state === 'status') {
                // Check if we have enough data for a packet
                if (buffer.length >= 1) {
                    try {
                        const packetLength = readVarInt(buffer, 0);
                        
                        if (buffer.length >= packetLength.length + packetLength.value) {
                            const packetId = readVarInt(buffer, packetLength.length);
                            
                            if (packetId.value === 0x00) {
                                // Status Request
                                console.log('Status request received');
                                const statusResponse = createStatusResponse();
                                const responseData = writeString(statusResponse);
                                const responsePacket = createPacket(0x00, responseData);
                                socket.write(responsePacket);
                                
                            } else if (packetId.value === 0x01) {
                                // Ping Request
                                console.log('Ping request received');
                                const pingData = buffer.slice(packetLength.length + packetId.length, packetLength.length + packetLength.value);
                                const pongPacket = createPacket(0x01, pingData);
                                socket.write(pongPacket);
                                
                                // Close connection after pong
                                setTimeout(() => {
                                    socket.end();
                                }, 100);
                            }
                            
                            // Remove processed packet from buffer
                            buffer = buffer.slice(packetLength.length + packetLength.value);
                        }
                    } catch (error) {
                        console.log('Error processing status packet:', error.message);
                        socket.end();
                    }
                }
            }
        } catch (error) {
            console.log('Error processing data:', error.message);
            socket.end();
        }
    });
    
    socket.on('end', () => {
        console.log(`Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
    });
    
    socket.on('error', (error) => {
        console.log(`Socket error: ${error.message}`);
    });
});

// Start the server
server.listen(SERVER_PORT, () => {
    console.log(`Minecraft ping-only server listening on port ${SERVER_PORT}`);
    console.log(`Server version: ${SERVER_VERSION} (Protocol ${PROTOCOL_VERSION})`);
    console.log(`Max players: ${MAX_PLAYERS}`);
    console.log(`Description: ${SERVER_DESCRIPTION}`);
});

server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
