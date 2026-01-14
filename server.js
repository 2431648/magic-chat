const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const axios = require('axios'); // Humne naya tool use kiya hai

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Store user languages
const userLanguages = {};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Translation Helper (Using Axios now)
async function translateText(text, targetLang) {
    // Agar English to English hai, toh API call mat karo (Speed badhegi)
    if (targetLang === 'en') return text; 
    
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLang}`;
        const response = await axios.get(url);
        return response.data.responseData.translatedText;
    } catch (error) {
        console.error("Translation Error:", error.message);
        return text; // Error aaya toh original text bhej do
    }
}

io.on('connection', (socket) => {
  console.log('User connected ID:', socket.id);
  
  // Default language
  userLanguages[socket.id] = 'en';

  socket.on('set language', (lang) => {
    userLanguages[socket.id] = lang;
    console.log(`User ${socket.id} selected: ${lang}`);
  });

  socket.on('chat message', async (msg) => {
    console.log(`Message received: ${msg}`);

    // Get all connected users
    const sockets = await io.fetchSockets();

    // Har user ke liye alag loop chalakar message translate karo
    for (const clientSocket of sockets) {
        const targetLang = userLanguages[clientSocket.id] || 'en';
        
        // Wait for translation
        const translatedMsg = await translateText(msg, targetLang);
        
        // Send to specific user
        clientSocket.emit('chat message', `[${targetLang.toUpperCase()}] : ${translatedMsg}`);
    }
  });

  socket.on('disconnect', () => {
    delete userLanguages[socket.id];
  });
});
// Render apna Port dega, agar nahi diya toh 3000 use karenge
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});