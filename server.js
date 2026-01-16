const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const translate = require('google-translate-api-x');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. DATABASE CONNECTION ---
const MONGO_URI = "mongodb+srv://admin:superman123@cluster0.lrmoiy0.mongodb.net/magic-chat?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected Successfully!"))
  .catch(err => console.error("❌ DB Connection Error:", err.message));

// User Schema
const UserSchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isOnline: { type: Boolean, default: false }
});
const User = mongoose.model('User', UserSchema);

// Message Schema (NEW: Yahan chats save hongi)
const MessageSchema = new mongoose.Schema({
    roomID: String,
    sender: String,
    text: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

// --- TRANSLATION LOGIC ---
async function translateText(text, targetLang) {
    let cleanLang = targetLang.split('-')[0];
    try {
        const res = await translate(text, { to: cleanLang, autoCorrect: true });
        return res.text;
    } catch (googleError) {
        console.log("⚠️ Google API failed. Switching to Backup...");
        try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=Autodetect|${cleanLang}`;
            const response = await fetch(url);
            const data = await response.json();
            if(data.responseData && data.responseData.translatedText) {
                 return data.responseData.translatedText;
            }
        } catch (backupError) { console.error("❌ Backup failed."); }
        return text;
    }
}

// --- SOCKET LOGIC ---
const activeUsers = {};
const userLanguages = {}; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // LANGUAGE SETTING
    socket.on('set_language', (lang) => {
        userLanguages[socket.id] = lang;
    });

    // SIGNUP
    socket.on('signup', async ({ name, password }) => {
        try {
            if (await User.findOne({ name })) {
                socket.emit('auth_error', "Username already taken.");
            } else {
                const newUser = new User({ name, password });
                await newUser.save();
                socket.emit('auth_success', { name: newUser.name });
            }
        } catch (e) { socket.emit('auth_error', "Error: " + e.message); }
    });

    // LOGIN
    socket.on('login', async ({ name, password }) => {
        const user = await User.findOne({ name, password });
        if (user) {
            activeUsers[socket.id] = user.name;
            await User.updateOne({ name }, { isOnline: true });
            socket.emit('auth_success', { name: user.name });
            setTimeout(() => io.emit('refresh_users'), 500);
        } else {
            socket.emit('auth_error', "Invalid Username or Password.");
        }
    });

    // GET CONTACTS
    socket.on('get_users', async () => {
        const users = await User.find({}, 'name isOnline');
        const myName = activeUsers[socket.id];
        socket.emit('user_list', users.filter(u => u.name !== myName));
    });

    // JOIN PRIVATE ROOM & LOAD HISTORY (Updated)
    socket.on('join_private', async ({ toUser }) => {
        const myName = activeUsers[socket.id];
        if (!myName) return;
        const roomID = [myName, toUser].sort().join('_');
        
        socket.join(roomID);
        
        // Database se purani chats nikalo
        const history = await Message.find({ roomID }).sort('timestamp');
        socket.emit('chat_history', history); // Client ko bhejo
        
        socket.emit('room_joined', { roomID, chattingWith: toUser });
    });

    // SEND MESSAGE & SAVE TO DB (Updated)
    socket.on('private_message', async ({ roomID, msg }) => {
        const myName = activeUsers[socket.id];

        // 1. Save to Database (Sabse Zaroori)
        const newMsg = new Message({ roomID, sender: myName, text: msg });
        await newMsg.save();

        // 2. Sender ko dikhao
        socket.emit('receive_message', { sender: 'Me', text: msg, isMe: true });

        // 3. Receiver ko bhejo (Translate karke)
        const sockets = await io.in(roomID).fetchSockets();
        for (const s of sockets) {
            if (s.id !== socket.id) { // Receiver
                const receiverLang = userLanguages[s.id] || 'en-US';
                const translatedMsg = await translateText(msg, receiverLang);
                
                s.emit('receive_message', { 
                    sender: myName, 
                    text: translatedMsg, 
                    isMe: false 
                });
            }
        }
    });

    socket.on('disconnect', async () => {
        const name = activeUsers[socket.id];
        if (name) {
            await User.updateOne({ name }, { isOnline: false });
            delete activeUsers[socket.id];
            delete userLanguages[socket.id];
            io.emit('refresh_users');
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });
