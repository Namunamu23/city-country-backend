// server.js

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

// PostgreSQL Database Connection
const pool = require('./db');

// API Routes
const wordRoutes = require('./routes/words');
app.use('/api/words', wordRoutes);

// Auth route
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('Server is running');
});

// A Map to track which custom playerId is associated with which socket.id
const socketIdToPlayerId = new Map();

// Manage rooms and players
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Listen for custom playerId registration
  socket.on('register_playerId', (playerId) => {
    socketIdToPlayerId.set(socket.id, playerId);
    console.log(`Mapped socket.id ${socket.id} to custom playerId ${playerId}`);
  });

  // Listen for "get_rooms" from client and respond
  socket.on('get_rooms', async () => {
    socket.emit('update_rooms', await getPublicRooms());
  });

  // NEW OR CHANGED: Provide the entire player list in room with name & score
  socket.on('get_room_players', async ({ roomName }) => {
    const playersInRoom = await getRoomPlayersWithNames(roomName);
    // We emit only to this socket
    socket.emit('players_in_room', playersInRoom);
  });

  // Host a Room
  socket.on('host_room', async ({ roomName, password, playerId }) => {
    try {
      const roomExists = await pool.query('SELECT * FROM rooms WHERE name = $1', [roomName]);

      if (roomExists.rows.length > 0) {
        socket.emit('room_error', 'Room already exists!');
      } else {
        await pool.query(
          'INSERT INTO rooms (name, password, host_id) VALUES ($1, $2, $3)',
          [roomName, password, playerId]
        );

        await pool.query(
          'INSERT INTO room_players (player_id, room_name) VALUES ($1, $2)',
          [playerId, roomName]
        );

        socket.join(roomName);
        console.log(`Room "${roomName}" hosted by ${playerId}`);

        // Update everyone’s room list
        io.emit('update_rooms', await getPublicRooms());

        // Let everyone in the room (just the host now) know who’s in
        const newPlayers = await getRoomPlayersWithNames(roomName);
        io.to(roomName).emit('player_joined', newPlayers);

        // Also tell the host to go to /game/roomName
        socket.emit('join_room_success', { roomName });
      }
    } catch (err) {
      console.error(err);
      socket.emit('room_error', 'Failed to create room.');
    }
  });

  // Join a Room
  socket.on('join_room', async ({ roomName, password, playerId }) => {
    try {
      const room = await pool.query('SELECT * FROM rooms WHERE name = $1', [roomName]);

      if (room.rows.length === 0) {
        socket.emit('room_error', 'Room does not exist!');
      } else if (room.rows[0].password !== password) {
        socket.emit('room_error', 'Incorrect password!');
      } else {
        const existingPlayer = await pool.query(
          'SELECT * FROM room_players WHERE player_id = $1 AND room_name = $2',
          [playerId, roomName]
        );

        if (existingPlayer.rows.length > 0) {
          socket.emit('room_error', 'You are already in this room!');
        } else {
          await pool.query(
            'INSERT INTO room_players (player_id, room_name) VALUES ($1, $2)',
            [playerId, roomName]
          );

          socket.join(roomName);
          console.log(`Player ${playerId} joined room "${roomName}"`);

          // Notify everyone in the room about the updated players list
          const newPlayers = await getRoomPlayersWithNames(roomName);
          io.to(roomName).emit('player_joined', newPlayers);

          // Update global rooms list
          io.emit('update_rooms', await getPublicRooms());

          // Navigate this user to /game/roomName
          socket.emit('join_room_success', { roomName });
        }
      }
    } catch (err) {
      console.error(err);
      socket.emit('room_error', 'Failed to join room.');
    }
  });

  // Leave a Room
  socket.on('leave_room', async ({ roomName, playerId }) => {
    try {
      // Remove player from the room
      await pool.query(
        'DELETE FROM room_players WHERE player_id = $1 AND room_name = $2',
        [playerId, roomName]
      );

      // Check if the player was the host
      const room = await pool.query('SELECT host_id FROM rooms WHERE name = $1', [roomName]);

      // If the host left, delete the room
      if (room.rows.length > 0 && room.rows[0].host_id === playerId) {
        await pool.query('DELETE FROM rooms WHERE name = $1', [roomName]);
        console.log(`Room "${roomName}" deleted by the host.`);
      }

      socket.leave(roomName);

      // Notify remaining players in the room
      const updatedPlayers = await getRoomPlayersWithNames(roomName);
      io.to(roomName).emit('player_left', updatedPlayers);

      // Update everyone’s room list
      io.emit('update_rooms', await getPublicRooms());
    } catch (err) {
      console.error(err);
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);

    const disconnectedPlayerId = socketIdToPlayerId.get(socket.id);
    if (!disconnectedPlayerId) {
      return;
    }

    try {
      // Remove them from all rooms
      const roomsForPlayer = await pool.query(
        'SELECT room_name FROM room_players WHERE player_id = $1',
        [disconnectedPlayerId]
      );

      for (const row of roomsForPlayer.rows) {
        const { room_name } = row;

        // Remove the player from that room
        await pool.query(
          'DELETE FROM room_players WHERE player_id = $1 AND room_name = $2',
          [disconnectedPlayerId, room_name]
        );

        // Check if they were the host
        const room = await pool.query('SELECT host_id FROM rooms WHERE name = $1', [room_name]);
        if (room.rows.length > 0 && room.rows[0].host_id === disconnectedPlayerId) {
          await pool.query('DELETE FROM rooms WHERE name = $1', [room_name]);
          console.log(`Room "${room_name}" deleted by the host on disconnect.`);
        } else {
          // Otherwise let others know
          const updatedPlayers = await getRoomPlayersWithNames(room_name);
          io.to(room_name).emit('player_left', updatedPlayers);
        }
      }

      // Clean up
      socketIdToPlayerId.delete(socket.id);
      io.emit('update_rooms', await getPublicRooms());
    } catch (err) {
      console.error(err);
    }
  });
});

// Return a list of { name, score } for all rooms
async function getPublicRooms() {
  const result = await pool.query(`
    SELECT r.name, COUNT(rp.player_id) AS player_count
    FROM rooms r
    LEFT JOIN room_players rp ON r.name = rp.room_name
    GROUP BY r.name
  `);
  return result.rows.map((room) => ({
    name: room.name,
    player_count: parseInt(room.player_count, 10) || 0,
  }));
}

// Get players in a room with their name and score
async function getRoomPlayersWithNames(roomName) {
  const result = await pool.query(
    `
      SELECT p.name::text, p.total_score::integer AS score
      FROM room_players rp
      JOIN players p ON rp.player_id::VARCHAR = p.id::VARCHAR
      WHERE rp.room_name = $1
    `,
    [roomName]
  );
  return result.rows;
}

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
